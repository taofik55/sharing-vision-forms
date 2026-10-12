"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

export const bundleKey = (formId: string, filters: RpcFilters) =>
  ["dashboard-bundle", formId, filters] as const;

/** All overview + question stats in one RPC (aggregated in Postgres). */
export function useDashboardBundle(
  formId: string,
  filters: RpcFilters,
  initial: { filters: RpcFilters; data: DashboardBundle } | null,
  polling: boolean,
) {
  const sameAsInitial =
    initial !== null &&
    JSON.stringify(initial.filters) === JSON.stringify(filters);
  return useQuery({
    queryKey: bundleKey(formId, filters),
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().rpc("dashboard_bundle", {
        p_form_id: formId,
        p_filters: filters as never,
      });
      if (error) throw error;
      return data as unknown as DashboardBundle;
    },
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
  return useQuery({
    queryKey: ["cross-stats", formId, a, b, filters, version],
    enabled: Boolean(a && b && a !== b),
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().rpc("cross_stats", {
        p_form_id: formId,
        p_question_a: a!,
        p_question_b: b!,
        p_filters: filters as never,
      });
      if (error) throw error;
      return data as unknown as CrossStats;
    },
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
  return useQuery({
    queryKey: ["cross-suggestions", formId, filters, bucket],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser().rpc("cross_suggestions", {
        p_form_id: formId,
        p_filters: filters as never,
      });
      if (error) throw error;
      return data as unknown as CrossSuggestion[];
    },
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

export type LiveStatus = "live" | "reconnecting" | "paused";

type LiveOptions = {
  formId: string;
  paused: boolean;
  /** Called immediately for each INSERT visible to this user. */
  onInsert: (row: { id: string; submitted_at: string }) => void;
  /** Debounced: 1.5 s trailing, at most 5 s after the first event. */
  onRefetch: () => void;
};

/**
 * Supabase Realtime on public.responses (RLS applies to the subscriber).
 * Falls back to polling (via `connected === false`) while the channel errors.
 */
export function useLiveResponses({
  formId,
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

  useEffect(() => {
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
            if (pausedRef.current) {
              setPending((n) => n + 1);
              return;
            }
            handlers.current.onInsert(row);
            schedule();
          },
        )
        // DELETE payloads only carry the primary key (and cannot be filtered),
        // so any delete triggers a quiet refetch.
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "responses" },
          () => {
            if (pausedRef.current) setPending((n) => n + 1);
            else schedule();
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
      if (channel) void supabase.removeChannel(channel);
    };
  }, [formId, schedule]);

  const status: LiveStatus = paused
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
    polling: connected === false && !paused,
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
