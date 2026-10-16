"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ChartQueryResult } from "@/lib/analytics/chart-result";
import type { ChartSpec } from "@/lib/analytics/chart-spec";
import type { RpcFilters } from "@/lib/analytics/filters";
import type {
  CrossStats,
  CrossSuggestion,
  DashboardBundle,
} from "@/lib/analytics/types";
import { createClient } from "@/lib/supabase/client";

let browserClient: ReturnType<typeof createClient> | null = null;
export function supabaseBrowser() {
  browserClient ??= createClient();
  return browserClient;
}

export type DashboardRpc =
  | "dashboard_bundle"
  | "cross_stats"
  | "cross_suggestions"
  | "question_text_answers"
  | "dashboard_query";

/** Extra context some sources need (public dashboards run saved charts by id). */
export type CallMeta = { widgetId?: string };

/**
 * Where dashboard data comes from: Supabase as the signed-in user (app), the
 * share-token API (public dashboards) or the timed demo API (scale page).
 */
export type DataSource = {
  call: <T>(
    fn: DashboardRpc,
    args: Record<string, unknown>,
    meta?: CallMeta,
  ) => Promise<T>;
};

export const supabaseSource: DataSource = {
  call: async <T>(fn: DashboardRpc, args: Record<string, unknown>) => {
    const { data, error } = await supabaseBrowser().rpc(fn, args as never);
    if (error) throw error;
    return data as T;
  },
};

/** Public dashboards: GET /api/d/:token/stats (date range only). */
export function publicSource(token: string): DataSource {
  return {
    call: async <T>(
      fn: DashboardRpc,
      args: Record<string, unknown>,
      meta?: CallMeta,
    ) => {
      const params = new URLSearchParams();
      const filters = (args.p_filters ?? {}) as { from?: string; to?: string };
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (fn === "dashboard_bundle") params.set("fn", "bundle");
      // Public viewers never send a chart spec: the server runs the chart
      // saved under this widget id in the dashboard config.
      else if (fn === "dashboard_query") {
        params.set("fn", "chart");
        params.set("widget", meta?.widgetId ?? "");
      } else if (fn === "cross_suggestions") params.set("fn", "suggestions");
      else if (fn === "cross_stats") {
        params.set("fn", "cross");
        params.set("a", String(args.p_question_a));
        params.set("b", String(args.p_question_b));
      } else {
        params.set("fn", "text");
        params.set("key", String(args.p_question_key));
        if (args.p_before_at) params.set("before_at", String(args.p_before_at));
        if (args.p_before_id) params.set("before_id", String(args.p_before_id));
      }
      const response = await fetch(
        `/api/d/${encodeURIComponent(token)}/stats?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`stats ${response.status}`);
      return (await response.json()) as T;
    },
  };
}

const DataSourceContext = createContext<DataSource>(supabaseSource);
export const DataSourceProvider = DataSourceContext;
export function useDataSource(): DataSource {
  return useContext(DataSourceContext);
}

export const bundleKey = (formId: string, filters: RpcFilters) =>
  ["dashboard-bundle", formId, filters] as const;

/** All overview + question stats in one RPC (aggregated in Postgres). */
export function useDashboardBundle(
  formId: string,
  filters: RpcFilters,
  initial: { filters: RpcFilters; data: DashboardBundle } | null,
  polling: boolean,
) {
  const source = useDataSource();
  const sameAsInitial =
    initial !== null &&
    JSON.stringify(initial.filters) === JSON.stringify(filters);
  return useQuery({
    queryKey: bundleKey(formId, filters),
    queryFn: () =>
      source.call<DashboardBundle>("dashboard_bundle", {
        p_form_id: formId,
        p_filters: filters,
      }),
    initialData: sameAsInitial ? initial.data : undefined,
    placeholderData: (previous) => previous,
    refetchInterval: polling ? 10_000 : false,
  });
}

export function useCrossStats(
  formId: string,
  a: string | undefined,
  b: string | undefined,
  filters: RpcFilters,
  version: number,
) {
  const source = useDataSource();
  return useQuery({
    queryKey: ["cross-stats", formId, a, b, filters, version],
    enabled: Boolean(a && b && a !== b),
    queryFn: () =>
      source.call<CrossStats>("cross_stats", {
        p_form_id: formId,
        p_question_a: a,
        p_question_b: b,
        p_filters: filters,
      }),
    placeholderData: (previous) => previous,
  });
}

/** Ranked relationships; heavier, so cached longer and not refetched on every live event. */
export function useCrossSuggestions(
  formId: string,
  filters: RpcFilters,
  total: number,
) {
  // Re-rank when the dataset grows by ~10% (bucketed), not on every response.
  const bucket = Math.floor(Math.log(Math.max(total, 1)) / Math.log(1.1));
  const source = useDataSource();
  return useQuery({
    queryKey: ["cross-suggestions", formId, filters, bucket],
    queryFn: () =>
      source.call<CrossSuggestion[]>("cross_suggestions", {
        p_form_id: formId,
        p_filters: filters,
      }),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

/** One custom chart (aggregated in Postgres by dashboard_query). */
export function useChartQuery(
  formId: string,
  widgetId: string,
  spec: ChartSpec | undefined,
  filters: RpcFilters,
  version: number,
  enabled = true,
) {
  const source = useDataSource();
  return useQuery({
    queryKey: ["chart-query", formId, widgetId, spec, filters, version],
    enabled: enabled && Boolean(spec),
    queryFn: () =>
      source.call<ChartQueryResult>(
        "dashboard_query",
        { p_form_id: formId, p_spec: spec, p_filters: filters },
        { widgetId },
      ),
    placeholderData: (previous) => previous,
    retry: false,
  });
}

export type LiveStatus = "live" | "reconnecting" | "paused" | "polling";

type LiveOptions = {
  formId: string;
  /** False on public dashboards (anonymous users cannot use Realtime). */
  enabled: boolean;
  paused: boolean;
  /**
   * INSERTs visible to this user, batched: at most one call per 250 ms, so
   * counters re-render at most 4 times per second at high insert rates.
   */
  onInsert: (rows: { id: string; submitted_at: string }[]) => void;
  /** Debounced: 1.5 s trailing, at most 5 s after the first event. */
  onRefetch: () => void;
};

/**
 * Supabase Realtime on public.responses (RLS applies to the subscriber).
 * Falls back to polling (via `connected === false`) while the channel errors.
 */
export function useLiveResponses({
  formId,
  enabled,
  paused,
  onInsert,
  onRefetch,
}: LiveOptions) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);
  const pausedRef = useRef(paused);
  const handlers = useRef({ onInsert, onRefetch });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWait = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Event batching (<= 4 UI updates per second).
  const inserted = useRef<{ id: string; submitted_at: string }[]>([]);
  const pendingDelta = useRef(0);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    handlers.current = { onInsert, onRefetch };
    pausedRef.current = paused;
  });

  const flush = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (maxWait.current) clearTimeout(maxWait.current);
    debounce.current = null;
    maxWait.current = null;
    handlers.current.onRefetch();
  }, []);

  const schedule = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(flush, 1500);
    maxWait.current ??= setTimeout(flush, 5000);
  }, [flush]);

  const queueUiUpdate = useCallback(() => {
    batchTimer.current ??= setTimeout(() => {
      batchTimer.current = null;
      const rows = inserted.current;
      inserted.current = [];
      const delta = pendingDelta.current;
      pendingDelta.current = 0;
      if (rows.length) handlers.current.onInsert(rows);
      if (delta) setPending((n) => n + delta);
    }, 250);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const supabase = supabaseBrowser();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      // Join with the signed-in user's JWT (not the anon key) so Realtime
      // applies that user's RLS; the cookie session loads asynchronously.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session)
        await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`responses:${formId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "responses",
            filter: `form_id=eq.${formId}`,
          },
          (payload) => {
            const row = payload.new as { id: string; submitted_at: string };
            if (pausedRef.current) pendingDelta.current += 1;
            else {
              inserted.current.push(row);
              schedule();
            }
            queueUiUpdate();
          },
        )
        // DELETE payloads only carry the primary key (and cannot be filtered),
        // so any delete triggers a quiet refetch.
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "responses" },
          () => {
            if (pausedRef.current) {
              pendingDelta.current += 1;
              queueUiUpdate();
            } else schedule();
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setConnected(true);
          else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          )
            setConnected(false);
        });
    })();

    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
      if (maxWait.current) clearTimeout(maxWait.current);
      if (batchTimer.current) clearTimeout(batchTimer.current);
      batchTimer.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [formId, enabled, schedule, queueUiUpdate]);

  const status: LiveStatus = !enabled
    ? "polling"
    : paused
      ? "paused"
      : connected === false
        ? "reconnecting"
        : "live";

  const applyPending = useCallback(() => {
    setPending(0);
    flush();
  }, [flush]);

  return {
    status,
    polling: enabled && connected === false && !paused,
    pending,
    applyPending,
  };
}

/** Invalidates every dashboard query of a form (bundle, cross stats, text answers). */
export function useInvalidateDashboard(formId: string) {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[1] === formId && q.queryKey[0] !== "cross-suggestions",
    });
  }, [client, formId]);
}

/** Current time in whole seconds, ticking every second; null during SSR (no hydration mismatch). */
export function useNow(): number | null {
  const seconds = useSyncExternalStore(
    (notify) => {
      const id = setInterval(notify, 1000);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / 1000),
    () => null,
  );
  return seconds === null ? null : seconds * 1000;
}

/** Stable JSON-equal memo for filter objects. */
export function useStable<T>(value: T): T {
  const json = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [json]);
}
