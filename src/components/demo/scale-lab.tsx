"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Gauge, LoaderCircle, Play, Square, Trash2, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  DashboardView,
  type DashboardViewProps,
} from "@/components/dashboard/dashboard-view";
import {
  useNow,
  type DashboardRpc,
  type DataSource,
} from "@/components/dashboard/use-dashboard-data";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  analyzeDemoAction,
  clearDemoBatchAction,
  generateDemoBatchAction,
  simulateDemoAction,
} from "@/app/[locale]/(app)/admin/demo/scale/actions";
import type { DashboardBundle } from "@/lib/analytics/types";
import { DEMO_CHUNK, DEMO_DELETE_CHUNK } from "@/lib/demo/limits";
import { cn } from "@/lib/utils";

const PRESETS = [1_000, 10_000, 50_000, 100_000] as const;
const SPREADS = [7, 30, 90] as const;
const RATES = [1, 5, 20] as const;
const WINDOW = 20;

type Job = {
  kind: "generate" | "clear";
  done: number;
  target: number | null;
  startedAt: number;
  finishedMs: number | null;
};

type Sample = { serverMs: number; roundTripMs: number; bytes: number };

/** Performance targets (ms): green at or below `good`, amber at or below `ok`. */
const TARGETS: Record<DashboardRpc | "render", { good: number; ok: number }> = {
  dashboard_bundle: { good: 400, ok: 1000 },
  cross_stats: { good: 400, ok: 1000 },
  cross_suggestions: { good: 1000, ok: 2000 },
  question_text_answers: { good: 200, ok: 500 },
  render: { good: 100, ok: 300 },
};

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

export function ScaleLab(
  props: Omit<
    DashboardViewProps,
    "mode" | "source" | "canEdit" | "onRendered" | "liveEnabled"
  >,
) {
  const t = useTranslations("demo");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(10_000);
  const [days, setDays] = useState<(typeof SPREADS)[number]>(30);
  const [job, setJob] = useState<Job | null>(null);
  const cancel = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // --- metrics (last 20 per call kind) ---------------------------------------
  const [samples, setSamples] = useState<
    Partial<Record<DashboardRpc, Sample[]>>
  >({});
  const [renders, setRenders] = useState<number[]>([]);
  const [total, setTotal] = useState(props.initialBundle.overview.total);
  const now = useNow();

  const source = useMemo<DataSource>(
    () => ({
      call: async <T,>(fn: DashboardRpc, args: Record<string, unknown>) => {
        const started = performance.now();
        const response = await fetch("/api/demo/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fn, args }),
        });
        const text = await response.text();
        const roundTripMs = performance.now() - started;
        if (!response.ok) throw new Error(`demo rpc ${response.status}`);
        const parsed = JSON.parse(text) as { data: T; serverMs: number };
        const sample = {
          serverMs: parsed.serverMs,
          roundTripMs,
          bytes: text.length,
        };
        setSamples((current) => ({
          ...current,
          [fn]: [...(current[fn] ?? []), sample].slice(-WINDOW),
        }));
        if (fn === "dashboard_bundle") {
          setTotal((parsed.data as unknown as DashboardBundle).overview.total);
        }
        return parsed.data;
      },
    }),
    [],
  );
  const onRendered = useCallback(
    (ms: number) => setRenders((current) => [...current, ms].slice(-WINDOW)),
    [],
  );

  const refreshPreview = useCallback(async () => {
    await analyzeDemoAction();
    await queryClient.invalidateQueries();
  }, [queryClient]);

  // --- generate / clear ------------------------------------------------------
  async function generate() {
    cancel.current = false;
    const startedAt = Date.now();
    setJob({
      kind: "generate",
      done: 0,
      target: preset,
      startedAt,
      finishedMs: null,
    });
    let done = 0;
    while (done < preset && !cancel.current) {
      const n = Math.min(DEMO_CHUNK, preset - done);
      const result = await generateDemoBatchAction({
        formId: props.formId,
        n,
        days,
      });
      if (!result.ok) {
        toast.error(t("errors.generic"));
        break;
      }
      done += n;
      setJob((j) => (j ? { ...j, done } : j));
    }
    const finishedMs = Date.now() - startedAt;
    setJob((j) => (j ? { ...j, finishedMs } : j));
    toast.success(
      t("generated", { count: done, seconds: (finishedMs / 1000).toFixed(1) }),
    );
    await refreshPreview();
  }

  async function clear() {
    cancel.current = false;
    const startedAt = Date.now();
    setJob({
      kind: "clear",
      done: 0,
      target: null,
      startedAt,
      finishedMs: null,
    });
    let done = 0;
    for (;;) {
      const result = await clearDemoBatchAction(props.formId);
      if (!result.ok) {
        toast.error(t("errors.generic"));
        break;
      }
      done += result.data.deleted;
      setJob((j) => (j ? { ...j, done } : j));
      if (result.data.deleted < DEMO_DELETE_CHUNK || cancel.current) break;
    }
    const finishedMs = Date.now() - startedAt;
    setJob((j) => (j ? { ...j, finishedMs } : j));
    toast.success(t("cleared", { count: done }));
    await refreshPreview();
  }

  const running = job !== null && job.finishedMs === null;

  // --- live simulator --------------------------------------------------------
  const [rate, setRate] = useState<(typeof RATES)[number]>(5);
  const [simulating, setSimulating] = useState(false);
  const [sent, setSent] = useState(0);
  const [tickMs, setTickMs] = useState<number | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!simulating) return;
    // One server action per second; a slow tick is skipped, not queued.
    const id = setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const result = await simulateDemoAction({ formId: props.formId, rate });
      inFlight.current = false;
      if (result.ok) {
        setSent((n) => n + rate);
        setTickMs(result.data.ms);
      } else {
        setSimulating(false);
        toast.error(t("errors.generic"));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [simulating, rate, props.formId, t]);

  const elapsed = job
    ? (job.finishedMs ?? Math.max(0, (now ?? job.startedAt) - job.startedAt)) /
      1000
    : 0;
  const progress = job?.target
    ? Math.round((100 * job.done) / job.target)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("generate.title")}</CardTitle>
            <CardDescription>{t("generate.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground" id="preset-label">
                {t("generate.count")}
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={String(preset)}
                onValueChange={(v) =>
                  v && setPreset(Number(v) as (typeof PRESETS)[number])
                }
                aria-labelledby="preset-label"
                className="flex-wrap"
              >
                {PRESETS.map((p) => (
                  <ToggleGroupItem
                    key={p}
                    value={String(p)}
                    data-testid={`preset-${p}`}
                  >
                    {format.number(p)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground" id="spread-label">
                {t("generate.spread")}
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={String(days)}
                onValueChange={(v) =>
                  v && setDays(Number(v) as (typeof SPREADS)[number])
                }
                aria-labelledby="spread-label"
              >
                {SPREADS.map((d) => (
                  <ToggleGroupItem key={d} value={String(d)}>
                    {t("generate.days", { days: d })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => void generate()}
                disabled={running}
                data-testid="generate-demo"
              >
                {running && job?.kind === "generate" ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Zap aria-hidden />
                )}
                {t("generate.button")}
              </Button>
              {running && (
                <Button
                  variant="outline"
                  onClick={() => (cancel.current = true)}
                >
                  {t("cancel")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("simulator.title")}</CardTitle>
            <CardDescription>{t("simulator.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground" id="rate-label">
                {t("simulator.rate")}
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={String(rate)}
                onValueChange={(v) =>
                  v && setRate(Number(v) as (typeof RATES)[number])
                }
                aria-labelledby="rate-label"
              >
                {RATES.map((r) => (
                  <ToggleGroupItem
                    key={r}
                    value={String(r)}
                    data-testid={`rate-${r}`}
                  >
                    {t("simulator.perSecond", { rate: r })}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={simulating ? "destructive" : "default"}
                onClick={() => setSimulating((s) => !s)}
                disabled={running}
                data-testid="simulator-toggle"
              >
                {simulating ? <Square aria-hidden /> : <Play aria-hidden />}
                {simulating ? t("simulator.stop") : t("simulator.start")}
              </Button>
              <span
                className="text-sm text-muted-foreground"
                data-testid="simulator-sent"
              >
                {t("simulator.sent", { count: sent })}
                {tickMs !== null && ` · ${t("simulator.tick", { ms: tickMs })}`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("simulator.tabNote")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("clear.title")}</CardTitle>
            <CardDescription>{t("clear.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm">
              {t("currentTotal")}:{" "}
              <span
                className="font-semibold tabular-nums"
                data-testid="scale-total"
              >
                {format.number(total)}
              </span>
            </p>
            <Button
              variant="outline"
              className="w-fit text-destructive hover:text-destructive"
              onClick={() => setConfirmClear(true)}
              disabled={running || simulating}
              data-testid="clear-demo"
            >
              <Trash2 aria-hidden />
              {t("clear.button")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {job && (
        <div
          className="flex flex-col gap-2 rounded-lg border p-4"
          role="status"
          data-testid="demo-job"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">
              {job.kind === "generate"
                ? t("progress.generating", {
                    done: format.number(job.done),
                    target: format.number(job.target ?? 0),
                  })
                : t("progress.clearing", { done: format.number(job.done) })}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {job.finishedMs !== null
                ? t("progress.finished", { seconds: elapsed.toFixed(1) })
                : t("progress.elapsed", { seconds: elapsed.toFixed(0) })}
            </span>
          </div>
          {progress !== null && (
            <Progress value={progress} aria-label={t("progress.label")} />
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <DashboardView
            {...props}
            canEdit={false}
            mode="preview"
            source={source}
            onRendered={onRendered}
            liveEnabled={!running}
          />
        </div>
        <PerformancePanel samples={samples} renders={renders} total={total} />
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("clear.confirmTitle")}
        description={t("clear.confirmDescription")}
        confirmLabel={t("clear.button")}
        destructive
        onConfirm={() => {
          setConfirmClear(false);
          void clear();
        }}
      />
    </div>
  );
}

function Tone({
  ms,
  target,
}: {
  ms: number | null;
  target: { good: number; ok: number };
}) {
  const t = useTranslations("demo.performance");
  if (ms === null) return <span className="text-muted-foreground">—</span>;
  const level = ms <= target.good ? "good" : ms <= target.ok ? "ok" : "bad";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        level === "good" && "text-emerald-800 dark:text-emerald-400",
        level === "ok" && "text-amber-800 dark:text-amber-400",
        level === "bad" && "text-red-700 dark:text-red-400",
      )}
      title={t(`level.${level}`)}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          level === "good" && "bg-emerald-600",
          level === "ok" && "bg-amber-500",
          level === "bad" && "bg-red-600",
        )}
        aria-hidden
      />
      {Math.round(ms)}
      <span className="sr-only">{t(`level.${level}`)}</span>
    </span>
  );
}

function PerformancePanel({
  samples,
  renders,
  total,
}: {
  samples: Partial<Record<DashboardRpc, Sample[]>>;
  renders: number[];
  total: number;
}) {
  const t = useTranslations("demo.performance");
  const format = useFormatter();
  const rows = (Object.keys(TARGETS) as (DashboardRpc | "render")[]).filter(
    (k) => k !== "render",
  ) as DashboardRpc[];
  return (
    <Card className="h-fit xl:sticky xl:top-20" data-testid="performance-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description", { window: WINDOW })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p>
          {t("total")}:{" "}
          <span className="font-semibold tabular-nums">
            {format.number(total)}
          </span>
        </p>
        {rows.map((fn) => {
          const list = samples[fn] ?? [];
          const last = list.at(-1);
          const trips = list.map((s) => s.roundTripMs);
          return (
            <div
              key={fn}
              className="flex flex-col gap-1 border-t pt-3"
              data-testid={`perf-${fn}`}
            >
              <p className="font-mono text-xs">{fn}</p>
              {last ? (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{t("server")}</dt>
                  <dd>
                    <Tone ms={last.serverMs} target={TARGETS[fn]} />
                  </dd>
                  <dt className="text-muted-foreground">{t("roundTrip")}</dt>
                  <dd>
                    <Tone ms={last.roundTripMs} target={TARGETS[fn]} />
                  </dd>
                  <dt className="text-muted-foreground">
                    {t("p50p95", { n: list.length })}
                  </dt>
                  <dd className="flex gap-2">
                    <Tone ms={percentile(trips, 50)} target={TARGETS[fn]} />
                    <Tone ms={percentile(trips, 95)} target={TARGETS[fn]} />
                  </dd>
                  <dt className="text-muted-foreground">{t("payload")}</dt>
                  <dd className="tabular-nums">
                    {format.number(last.bytes / 1024, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    KB
                  </dd>
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noCalls")}</p>
              )}
            </div>
          );
        })}
        <div
          className="flex flex-col gap-1 border-t pt-3"
          data-testid="perf-render"
        >
          <p className="text-xs font-medium">{t("render")}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t("last")}</dt>
            <dd>
              <Tone ms={renders.at(-1) ?? null} target={TARGETS.render} />
            </dd>
            <dt className="text-muted-foreground">
              {t("p50p95", { n: renders.length })}
            </dt>
            <dd className="flex gap-2">
              <Tone ms={percentile(renders, 50)} target={TARGETS.render} />
              <Tone ms={percentile(renders, 95)} target={TARGETS.render} />
            </dd>
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">{t("legend")}</p>
      </CardContent>
    </Card>
  );
}
