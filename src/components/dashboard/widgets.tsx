"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart,
  DonutChart,
  Heatmap,
  SeriesChart,
  StatGrid,
  type Datum,
} from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { allowedCharts } from "@/lib/analytics/auto";
import type { Widget } from "@/lib/analytics/config";
import { toggleAnswerFilter } from "@/lib/analytics/filters";
import {
  crossInsight,
  overviewInsight,
  peakInsight,
  questionInsight,
  splitInsight,
  type Insight,
} from "@/lib/analytics/insights";
import { share, trendPercent } from "@/lib/analytics/stats";
import type { CrossStats, QuestionStats } from "@/lib/analytics/types";
import { isChoiceType, type Question } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useDashboard, useLabels } from "./dashboard-context";
import {
  useCrossStats,
  useCrossSuggestions,
  useDataSource,
  useNow,
} from "./use-dashboard-data";
import { WidgetCard, type CardBadge } from "./widget-card";

type Labels = ReturnType<typeof useLabels>;

function useInsightText() {
  const { t } = useLabels();
  return (insight: Insight | null | undefined) => {
    if (!insight) return null;
    const values = { ...insight.values };
    if (values.strength)
      values.strength = t(`insights.strength.${values.strength as "weak"}`);
    return t(`insights.${insight.key}` as "insights.noData", values);
  };
}

// -----------------------------------------------------------------------------
// Overview
// -----------------------------------------------------------------------------

export function OverviewKpis({ widget }: { widget: Widget }) {
  const { bundle, filters, presenting } = useDashboard();
  const labels = useLabels();
  const { t, fmt } = labels;
  const insightText = useInsightText();
  const o = bundle?.overview;
  if (!o) return <WidgetSkeleton widget={widget} />;

  const trend = trendPercent(o.last7, o.prev7);
  const completion = o.funnel.started
    ? o.funnel.submitted / o.funnel.started
    : null;
  const TrendIcon =
    trend === null
      ? ArrowUpRight
      : trend > 0
        ? ArrowUpRight
        : trend < 0
          ? ArrowDownRight
          : ArrowRight;
  const big = presenting ? "text-4xl" : "text-3xl";

  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? t("widgets.kpis")}
      help={t("help.kpis")}
      insight={insightText(overviewInsight(o, fmt))}
      table={{
        columns: [t("widgets.value"), t("widgets.count")],
        rows: [
          [t("widgets.total"), o.total],
          [t("widgets.today"), o.today],
          [t("widgets.trend7"), o.last7],
          [t("widgets.vsPrevious7"), o.prev7],
          [
            t("widgets.completion"),
            completion === null ? "—" : fmt.percent(completion),
          ],
          [t("widgets.medianDuration"), labels.duration(o.duration?.median)],
        ],
      }}
    >
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("widgets.total")}
          </dt>
          <dd
            className={cn(big, "font-semibold tabular-nums")}
            data-testid="kpi-total"
          >
            {fmt.number(o.total)}
          </dd>
          {filters.compare && o.previous_period !== null && (
            <dd className="text-xs text-muted-foreground">
              {t("widgets.previousPeriod", {
                count: fmt.number(o.previous_period),
              })}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("widgets.today")}
          </dt>
          <dd className={cn(big, "font-semibold tabular-nums")}>
            {fmt.number(o.today)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("widgets.trend7")}
          </dt>
          <dd className={cn(big, "font-semibold tabular-nums")}>
            {fmt.number(o.last7)}
          </dd>
          <dd className="flex items-center gap-1 text-xs">
            <TrendIcon
              className={cn(
                "size-3.5",
                trend !== null && trend > 0 && "text-[var(--status-good-text)]",
                trend !== null && trend < 0 && "text-[var(--status-critical)]",
              )}
              aria-hidden
            />
            <span className="text-muted-foreground">
              {trend === null
                ? t("widgets.newActivity")
                : trend === 0
                  ? t("widgets.noChange")
                  : `${trend > 0 ? "+" : "−"}${fmt.percent(Math.abs(trend) / 100)}`}{" "}
              {t("widgets.vsPrevious7")}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("widgets.completion")}
          </dt>
          <dd className={cn(big, "font-semibold tabular-nums")}>
            {completion === null ? "—" : fmt.percent(completion)}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {t("widgets.completionDetail", {
              submitted: fmt.number(o.funnel.submitted),
              started: fmt.number(o.funnel.started),
            })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t("widgets.medianDuration")}
          </dt>
          <dd className={cn(big, "font-semibold tabular-nums")}>
            {labels.duration(o.duration?.median)}
          </dd>
        </div>
      </dl>
    </WidgetCard>
  );
}

function bucketLabel(t: string, granularity: string, labels: Labels): string {
  // Buckets are Jakarta wall time ("YYYY-MM-DDTHH:mm"), shown as-is.
  const [date, time] = t.split("T");
  const d = new Date(`${date}T00:00:00Z`);
  const day = labels.format.dateTime(d, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return granularity === "hour" ? `${day} ${time}` : day;
}

export function OverviewTimeline({ widget }: { widget: Widget }) {
  const { bundle } = useDashboard();
  const labels = useLabels();
  const { t } = labels;
  const timeline = bundle?.overview.timeline;
  const data: Datum[] = useMemo(
    () =>
      (timeline?.buckets ?? []).map((b) => ({
        id: b.t,
        label: bucketLabel(b.t, timeline!.granularity, labels),
        value: b.count,
        detail: String(b.count),
      })),
    [timeline, labels],
  );
  if (!bundle) return <WidgetSkeleton widget={widget} />;
  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? t("widgets.timeline")}
      help={t("help.timeline")}
      table={{
        columns: [t("widgets.date"), t("widgets.count")],
        rows: data.map((d) => [d.label, d.value]),
      }}
      charts={["area", "line"]}
    >
      <SeriesChart
        data={data}
        variant={widget.chart === "line" ? "line" : "area"}
        ariaLabel={t("widgets.timeline")}
      />
    </WidgetCard>
  );
}

export function OverviewHeatmap({ widget }: { widget: Widget }) {
  const { bundle } = useDashboard();
  const labels = useLabels();
  const { t, fmt } = labels;
  const insightText = useInsightText();
  if (!bundle) return <WidgetSkeleton widget={widget} />;
  const cells = bundle.overview.heatmap;
  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? t("widgets.heatmap")}
      subtitle={t("widgets.heatmapSubtitle")}
      help={t("help.heatmap")}
      insight={insightText(peakInsight(bundle.overview, fmt))}
      table={{
        columns: [t("widgets.weekday"), t("widgets.hour"), t("widgets.count")],
        rows: cells.map((c) => [
          t(`weekdays.${c.dow}` as "weekdays.1"),
          c.hour,
          c.count,
        ]),
      }}
    >
      <Heatmap
        cells={cells}
        dayLabel={(d) => t(`weekdaysShort.${d}` as "weekdaysShort.1")}
        cellTitle={(d, h, c) =>
          `${t(`weekdays.${d}` as "weekdays.1")} ${String(h).padStart(2, "0")}:00 · ${c}`
        }
        ariaLabel={t("widgets.heatmap")}
      />
    </WidgetCard>
  );
}

export function OverviewSplit({ widget }: { widget: Widget }) {
  const { bundle, filters, setFilters, presenting, drillDown } = useDashboard();
  const labels = useLabels();
  const { t, fmt } = labels;
  const insightText = useInsightText();
  const isDevices = widget.kind === "overview_devices";
  const rows =
    (isDevices ? bundle?.overview.devices : bundle?.overview.locales) ?? [];
  const label = isDevices ? labels.deviceLabel : labels.languageLabel;
  const data: Datum[] = rows.map((r) => ({
    id: r.key,
    label: label(r.key),
    value: r.count,
    detail: String(r.count),
  }));
  if (!bundle) return <WidgetSkeleton widget={widget} />;
  return (
    <WidgetCard
      widget={widget}
      title={
        widget.title ??
        (isDevices ? t("widgets.devices") : t("widgets.locales"))
      }
      help={t("help.split")}
      insight={insightText(splitInsight(rows, label, fmt))}
      table={{
        columns: [t("widgets.value"), t("widgets.count")],
        rows: data.map((d) => [d.label, d.value]),
      }}
    >
      <DonutChart
        data={data}
        palette={widget.palette}
        ariaLabel={widget.title ?? t("widgets.devices")}
        format={(v) => fmt.number(v)}
        onSelect={
          presenting || !drillDown
            ? undefined
            : (d) =>
                setFilters(
                  isDevices
                    ? {
                        ...filters,
                        device: filters.device === d.id ? undefined : d.id,
                      }
                    : {
                        ...filters,
                        locale: filters.locale === d.id ? undefined : d.id,
                      },
                )
        }
      />
    </WidgetCard>
  );
}

// -----------------------------------------------------------------------------
// Question widgets
// -----------------------------------------------------------------------------

function describeCondition(
  question: Question,
  questions: Record<string, Question>,
  labels: Labels,
): string | null {
  const group = question.showIf;
  if (!group?.conditions.length) return null;
  const { t, optionLabel } = labels;
  const parts = group.conditions.map((c) => {
    const ref = questions[c.questionKey];
    const name = ref ? `“${ref.title}”` : "?";
    const op =
      ref?.type === "date" && (c.operator === "gt" || c.operator === "lt")
        ? t(`operators.${c.operator === "gt" ? "gtDate" : "ltDate"}`)
        : t(`operators.${c.operator}`);
    const value =
      c.value === undefined
        ? ""
        : ref && isChoiceType(ref.type)
          ? ` “${optionLabel(c.questionKey, String(c.value))}”`
          : ` ${c.value}`;
    return `${name} ${op}${value}`;
  });
  return parts.join(group.combinator === "and" ? " & " : " / ");
}

export function questionBadges(
  question: Question,
  stats: QuestionStats | undefined,
  ctx: {
    questions: Record<string, Question>;
    currentKeys: Set<string>;
    versionCount: number;
  },
  labels: Labels,
  widget: Widget,
): CardBadge[] {
  const { t } = labels;
  const badges: CardBadge[] = [];
  if (!ctx.currentKeys.has(question.key))
    badges.push({ label: t("widgets.removed"), tone: "warning" });
  if (stats?.low_sample)
    badges.push({ label: t("widgets.lowSample"), tone: "warning" });
  badges.push({
    label: question.required ? t("widgets.required") : t("widgets.optional"),
    tone: "muted",
  });
  const condition = describeCondition(question, ctx.questions, labels);
  if (condition)
    badges.push({ label: t("widgets.conditional", { condition }) });
  const versions = stats?.version_numbers ?? [];
  if (versions.length && versions.length < ctx.versionCount) {
    badges.push({
      label: t("widgets.onlyVersions", { versions: versions.join(", ") }),
    });
  }
  if (widget.hidden) badges.push({ label: t("widgets.hidden"), tone: "muted" });
  return badges;
}

export const QuestionWidget = memo(function QuestionWidget({
  widget,
}: {
  widget: Widget;
}) {
  const ctx = useDashboard();
  const labels = useLabels();
  const insightText = useInsightText();
  const { t, fmt } = labels;
  const question = widget.questionKey
    ? ctx.questions[widget.questionKey]
    : undefined;
  const stats = widget.questionKey
    ? ctx.bundle?.questions[widget.questionKey]
    : undefined;
  if (!question) return null;
  if (!ctx.bundle) return <WidgetSkeleton widget={widget} />;

  const chart = widget.chart ?? allowedCharts(question.type)[0];
  const n = stats?.n ?? 0;
  const eligible = stats?.eligible ?? 0;
  const subtitle = `${t(`questionTypes.${question.type}`)} · ${t(
    "widgets.answered",
    {
      n: fmt.number(n),
      total: fmt.number(eligible),
      rate: fmt.percent(share(n, eligible)),
    },
  )}`;
  const drill = (value: string) =>
    !ctx.presenting &&
    ctx.drillDown &&
    ctx.setFilters(toggleAnswerFilter(ctx.filters, question.key, value));

  const body = renderQuestionBody(
    question,
    stats,
    chart,
    widget,
    labels,
    drill,
    ctx.textAnswers,
  );

  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? question.title}
      subtitle={subtitle}
      badges={questionBadges(question, stats, ctx, labels, widget)}
      insight={insightText(questionInsight(question, stats, fmt))}
      help={t(`help.${chart}`)}
      table={body.table}
      charts={allowedCharts(question.type)}
    >
      {body.node}
    </WidgetCard>
  );
});

function renderQuestionBody(
  question: Question,
  stats: QuestionStats | undefined,
  chart: string,
  widget: Widget,
  labels: Labels,
  drill: (value: string) => void,
  textAnswers: boolean,
): {
  node: React.ReactNode;
  table: { columns: string[]; rows: (string | number)[][] } | null;
} {
  const { t, fmt, optionLabel } = labels;
  if (!stats) return { node: <EmptyChart />, table: null };

  switch (stats.type) {
    case "multiple_choice":
    case "dropdown":
    case "checkboxes": {
      // Definition order first (stable colors per option), then removed options.
      const order = new Map((question.options ?? []).map((o, i) => [o.id, i]));
      const options = [...stats.options].sort(
        (a, b) =>
          (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999) ||
          b.count - a.count,
      );
      for (const o of question.options ?? []) {
        if (!options.some((x) => x.id === o.id))
          options.push({ id: o.id, count: 0, percent: 0 } as never);
      }
      const isCheckbox = stats.type === "checkboxes";
      const data: Datum[] = options.map((o) => ({
        id: o.id,
        label: optionLabel(question.key, o.id),
        value: isCheckbox
          ? Number((o as { percent?: number }).percent ?? 0)
          : o.count,
        detail: `${fmt.number(o.count)} · ${fmt.percent(share(o.count, stats.n))}`,
      }));
      const table = {
        columns: [
          t("widgets.option"),
          t("widgets.count"),
          t("widgets.percent"),
        ],
        rows: options.map((o) => [
          optionLabel(question.key, o.id),
          o.count,
          fmt.percent(share(o.count, stats.n)),
        ]),
      };
      if (chart === "table")
        return { node: <TableBody table={table} />, table: null };
      const node =
        chart === "donut" ? (
          <DonutChart
            data={data}
            palette={widget.palette}
            onSelect={(d) => drill(d.id)}
            format={(v) => fmt.number(v)}
            ariaLabel={question.title}
          />
        ) : (
          <div className="flex h-full flex-col gap-2">
            <div className="min-h-0 flex-1">
              <BarChart
                data={data}
                palette={
                  widget.palette ?? (isCheckbox ? "mono" : "categorical")
                }
                orientation={chart === "column" ? "vertical" : "horizontal"}
                onSelect={(d) => drill(d.id)}
                format={(v) => (isCheckbox ? fmt.number(v, 1) : fmt.number(v))}
                valueSuffix={isCheckbox ? "%" : ""}
                ariaLabel={question.title}
              />
            </div>
            {stats.type === "checkboxes" && (
              <p className="text-xs text-muted-foreground">
                {t("widgets.avgSelections", {
                  avg: fmt.number(stats.avg_selections ?? 0, 1),
                })}
                {stats.pairs[0] && (
                  <>
                    {" · "}
                    {t("widgets.topPairs")}:{" "}
                    {optionLabel(question.key, stats.pairs[0].a)} +{" "}
                    {optionLabel(question.key, stats.pairs[0].b)} (
                    {fmt.number(stats.pairs[0].count)})
                  </>
                )}
              </p>
            )}
          </div>
        );
      return { node, table };
    }

    case "rating":
    case "linear_scale": {
      const data: Datum[] = stats.distribution.map((d) => ({
        id: String(d.value),
        label: String(d.value),
        value: d.count,
        detail: `${fmt.number(d.count)} · ${fmt.percent(share(d.count, stats.n))}`,
      }));
      const table = {
        columns: [t("widgets.value"), t("widgets.count"), t("widgets.percent")],
        rows: stats.distribution.map((d) => [
          d.value,
          d.count,
          fmt.percent(share(d.count, stats.n)),
        ]),
      };
      const kpis = [
        {
          label: t("widgets.mean"),
          value: stats.mean === null ? "—" : fmt.number(stats.mean, 2),
        },
        {
          label: t("widgets.median"),
          value: stats.median === null ? "—" : fmt.number(stats.median, 1),
        },
      ];
      if (stats.nps !== null) {
        kpis.push({ label: t("widgets.nps"), value: fmt.number(stats.nps, 0) });
        kpis.push({
          label: `${t("widgets.promoters")} / ${t("widgets.detractors")}`,
          value: `${fmt.percent(share(stats.promoters ?? 0, stats.n))} / ${fmt.percent(share(stats.detractors ?? 0, stats.n))}`,
        });
      } else if (stats.csat !== null) {
        kpis.push({
          label: t("widgets.csat"),
          value: fmt.percent(stats.csat / 100),
        });
      }
      if (chart === "table")
        return { node: <TableBody table={table} />, table: null };
      const chartNode =
        chart === "donut" ? (
          <DonutChart
            data={data}
            palette={widget.palette ?? "sequential"}
            onSelect={(d) => drill(d.id)}
            format={(v) => fmt.number(v)}
            ariaLabel={question.title}
          />
        ) : chart === "line" ? (
          <SeriesChart data={data} variant="line" ariaLabel={question.title} />
        ) : (
          <BarChart
            data={data}
            palette={widget.palette ?? "sequential"}
            orientation="vertical"
            onSelect={(d) => drill(d.id)}
            format={(v) => fmt.number(v)}
            ariaLabel={question.title}
          />
        );
      return {
        node: (
          <div className="flex h-full flex-col gap-3">
            <StatGrid items={kpis} />
            <div className="min-h-0 flex-1">{chartNode}</div>
          </div>
        ),
        table,
      };
    }

    case "number": {
      const statsRows: [string, number | null][] = [
        [t("widgets.median"), stats.median],
        [t("widgets.mean"), stats.mean],
        [t("widgets.p25"), stats.p25],
        [t("widgets.p75"), stats.p75],
        [t("widgets.p90"), stats.p90],
        [t("widgets.min"), stats.min],
        [t("widgets.max"), stats.max],
        [t("widgets.stddev"), stats.stddev],
      ];
      const statsTable = {
        columns: [t("widgets.value"), ""],
        rows: statsRows.map(([k, v]) => [
          k,
          v === null ? "—" : fmt.number(v, 2),
        ]),
      };
      if (chart === "stats")
        return { node: <TableBody table={statsTable} />, table: null };
      const data: Datum[] = stats.histogram.map((b) => ({
        id: `${b.from}`,
        label: fmt.number(b.from, Math.abs(b.to - b.from) < 10 ? 1 : 0),
        value: b.count,
        detail: `${fmt.number(b.from, 1)}–${fmt.number(b.to, 1)}: ${fmt.number(b.count)}`,
      }));
      return {
        node: (
          <div className="flex h-full flex-col gap-3">
            <StatGrid
              items={statsRows.slice(0, 4).map(([label, v]) => ({
                label,
                value: v === null ? "—" : fmt.number(v, 1),
              }))}
            />
            <div className="min-h-0 flex-1">
              <BarChart
                data={data}
                palette={widget.palette ?? "mono"}
                orientation="vertical"
                format={(v) => fmt.number(v)}
                ariaLabel={question.title}
              />
            </div>
          </div>
        ),
        table: {
          columns: [t("widgets.range"), t("widgets.count")],
          rows: stats.histogram.map((b) => [
            `${fmt.number(b.from, 1)}–${fmt.number(b.to, 1)}`,
            b.count,
          ]),
        },
      };
    }

    case "date": {
      if (chart === "weekday") {
        const data: Datum[] = stats.weekdays.map((w) => ({
          id: String(w.dow),
          label: t(`weekdaysShort.${w.dow}` as "weekdaysShort.1"),
          value: w.count,
          detail: String(w.count),
        }));
        return {
          node: (
            <BarChart
              data={data}
              palette={widget.palette ?? "mono"}
              orientation="vertical"
              format={(v) => fmt.number(v)}
              ariaLabel={question.title}
            />
          ),
          table: {
            columns: [t("widgets.weekday"), t("widgets.count")],
            rows: data.map((d) => [d.label, d.value]),
          },
        };
      }
      const data: Datum[] = stats.series.map((s) => ({
        id: s.t,
        label: labels.format.dateTime(new Date(`${s.t}T00:00:00Z`), {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }),
        value: s.count,
        detail: String(s.count),
      }));
      return {
        node: (
          <SeriesChart
            data={data}
            variant={chart === "line" ? "line" : "area"}
            ariaLabel={question.title}
          />
        ),
        table: {
          columns: [t("widgets.date"), t("widgets.count")],
          rows: data.map((d) => [d.label, d.value]),
        },
      };
    }

    case "short_text":
    case "paragraph": {
      if (!textAnswers) {
        return {
          node: (
            <p className="text-sm text-muted-foreground">
              {t("widgets.textHidden")}
            </p>
          ),
          table: null,
        };
      }
      const data: Datum[] = stats.terms.slice(0, 10).map((term) => ({
        id: term.term,
        label: term.term,
        value: term.count,
        detail: String(term.count),
      }));
      return {
        node: (
          <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-h-40">
              {data.length ? (
                <BarChart
                  data={data}
                  palette="mono"
                  format={(v) => fmt.number(v)}
                  ariaLabel={question.title}
                />
              ) : (
                <EmptyChart />
              )}
            </div>
            <TextAnswers questionKey={question.key} />
          </div>
        ),
        table: {
          columns: [t("widgets.term"), t("widgets.count")],
          rows: stats.terms.map((x) => [x.term, x.count]),
        },
      };
    }

    default:
      return { node: null, table: null };
  }
}

function TableBody({
  table,
}: {
  table: { columns: string[]; rows: (string | number)[][] };
}) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  "border-b px-2 py-1 font-medium",
                  i === 0 ? "text-left" : "text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-2 py-1",
                    i > 0 && "text-right tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Latest raw text answers: keyset-paginated, virtualized list. */
function TextAnswers({ questionKey }: { questionKey: string }) {
  const { formId, rpcFilters, dataVersion } = useDashboard();
  const source = useDataSource();
  const { t, format } = useLabels();
  const parentRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const query = useInfiniteQuery({
    queryKey: ["text-answers", formId, questionKey, rpcFilters, dataVersion],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam }) =>
      (await source.call<
        { response_id: string; submitted_at: string; value: string }[] | null
      >("question_text_answers", {
        p_form_id: formId,
        p_question_key: questionKey,
        p_filters: rpcFilters,
        p_before_at: pageParam?.at,
        p_before_id: pageParam?.id,
        p_limit: 25,
      })) ?? [],
    getNextPageParam: (last) =>
      last.length === 25
        ? { at: last[24].submitted_at, id: last[24].response_id }
        : null,
  });
  const rows = query.data?.pages.flat() ?? [];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 6,
  });

  return (
    <div className="flex min-h-40 flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">
        {t("widgets.latestAnswers")}
      </p>
      {rows.length === 0 && !query.isLoading && (
        <p className="text-sm text-muted-foreground">
          {t("widgets.noAnswers")}
        </p>
      )}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border"
        role="region"
        aria-label={t("widgets.latestAnswers")}
        tabIndex={0}
        style={{ maxHeight: 260 }}
      >
        <ul
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <li
                key={row.response_id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute inset-x-0 border-b px-3 py-2 text-sm"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <p className="line-clamp-3">{row.value}</p>
                <p className="text-xs text-muted-foreground">
                  {now
                    ? format.relativeTime(
                        new Date(row.submitted_at),
                        new Date(now),
                      )
                    : format.dateTime(new Date(row.submitted_at), {
                        dateStyle: "medium",
                      })}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("widgets.loadMore")}
        </Button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Cross-tab, suggestions, KPI, text, heading
// -----------------------------------------------------------------------------

export function CrossWidget({ widget }: { widget: Widget }) {
  const ctx = useDashboard();
  const labels = useLabels();
  const insightText = useInsightText();
  const { t, fmt, optionLabel } = labels;
  const { data } = useCrossStats(
    ctx.formId,
    widget.questionKey,
    widget.questionKeyB,
    ctx.rpcFilters,
    ctx.dataVersion,
  );
  const a = widget.questionKey ? ctx.questions[widget.questionKey] : undefined;
  const b = widget.questionKeyB
    ? ctx.questions[widget.questionKeyB]
    : undefined;
  if (!a || !b) return null;
  const title = widget.title ?? t("widgets.cross", { a: a.title, b: b.title });
  if (!data) return <WidgetSkeleton widget={widget} />;
  const view = crossView(data, labels);
  return (
    <WidgetCard
      widget={widget}
      title={title}
      subtitle={t("widgets.crossSubtitle", { n: fmt.number(data.n) })}
      badges={[
        ...(data.low_sample
          ? [{ label: t("widgets.lowSample"), tone: "warning" as const }]
          : []),
        { label: t("dashboard.notCausation"), tone: "muted" as const },
      ]}
      help={t("help.cross")}
      insight={insightText(crossInsight(data, { ...fmt, option: optionLabel }))}
      table={view.table}
    >
      {view.node}
    </WidgetCard>
  );
}

function crossView(
  data: CrossStats,
  labels: Labels,
): {
  node: React.ReactNode;
  table: { columns: string[]; rows: (string | number)[][] } | null;
} {
  const { t, fmt, optionLabel } = labels;
  if (data.kind === "cat_num") {
    const rows: Datum[] = data.groups.map((g) => ({
      id: g.option,
      label: optionLabel(data.a, g.option),
      value: g.mean,
      detail: `${fmt.number(g.mean, 2)} · n = ${g.n}`,
    }));
    return {
      node: (
        <BarChart
          data={rows}
          palette="mono"
          format={(v) => fmt.number(v, 1)}
          ariaLabel={t("widgets.average")}
        />
      ),
      table: {
        columns: [
          t("widgets.group"),
          t("widgets.average"),
          t("widgets.respondents"),
        ],
        rows: data.groups.map((g) => [
          optionLabel(data.a, g.option),
          fmt.number(g.mean, 2),
          g.n,
        ]),
      },
    };
  }
  if (data.kind === "cat_cat") {
    const rowsA = Array.from(new Set(data.cells.map((c) => c.a)));
    const colsB = Array.from(new Set(data.cells.map((c) => c.b)));
    const table = {
      columns: ["", ...colsB.map((b) => optionLabel(data.b, b))],
      rows: rowsA.map((a) => [
        optionLabel(data.a, a),
        ...colsB.map(
          (b) => data.cells.find((c) => c.a === a && c.b === b)?.count ?? 0,
        ),
      ]),
    };
    return { node: <TableBody table={table} />, table: null };
  }
  if (data.kind === "num_num") {
    return {
      node: (
        <div
          className="h-full min-h-40"
          role="img"
          aria-label={t("widgets.correlation")}
        >
          <ResponsiveContainer width="100%" height="100%" minHeight={160}>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--chart-grid)" />
              <XAxis
                type="number"
                dataKey="x"
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                width={36}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <Tooltip />
              <Scatter
                data={data.points ?? []}
                fill="var(--series-1)"
                fillOpacity={0.6}
                isAnimationActive={process.env.NODE_ENV === "production"}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ),
      table: {
        columns: [t("widgets.correlation"), "n"],
        rows: [[data.r === null ? "—" : fmt.number(data.r, 3), data.n]],
      },
    };
  }
  return { node: <EmptyChart />, table: null };
}

export function SuggestionsWidget({ widget }: { widget: Widget }) {
  const ctx = useDashboard();
  const labels = useLabels();
  const { t, fmt } = labels;
  const { data, isLoading } = useCrossSuggestions(
    ctx.formId,
    ctx.rpcFilters,
    ctx.bundle?.overview.total ?? 0,
  );
  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? t("dashboard.possibleRelationships")}
      subtitle={t("dashboard.notCausation")}
      help={t("help.cross")}
    >
      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.loadingSuggestions")}
        </p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">
          {t("dashboard.noSuggestions")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="suggestions">
          {data.map((s) => {
            const a = ctx.questions[s.a]?.title ?? s.a;
            const b = ctx.questions[s.b]?.title ?? s.b;
            const metric =
              s.metric === "r"
                ? `r = ${fmt.number(s.value, 2)}`
                : s.metric === "cramers_v"
                  ? `V = ${fmt.number(s.value, 2)}`
                  : `Δ = ${fmt.number(s.value, 2)} SD`;
            return (
              <li
                key={`${s.a}:${s.b}`}
                className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {a} × {b}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metric} · n = {fmt.number(s.n)} ·{" "}
                    {t(`insights.strength.${strengthOf(s)}`)}
                  </p>
                </div>
                {ctx.editMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      ctx.addWidget({
                        id: `cross:${s.a}:${s.b}`,
                        kind: "cross",
                        origin: "user",
                        questionKey: s.a,
                        questionKeyB: s.b,
                      })
                    }
                  >
                    <Plus aria-hidden />
                    {t("dashboard.addWidget")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

function strengthOf(s: {
  metric: string;
  value: number;
}): "weak" | "moderate" | "strong" {
  const v = Math.abs(s.value);
  if (s.metric === "effect")
    return v >= 1.2 ? "strong" : v >= 0.8 ? "moderate" : "weak";
  return v >= 0.5 ? "strong" : v >= 0.3 ? "moderate" : "weak";
}

export function KpiWidget({ widget }: { widget: Widget }) {
  const ctx = useDashboard();
  const { t, fmt } = useLabels();
  if (!ctx.bundle) return <WidgetSkeleton widget={widget} />;
  const metric = widget.kpi?.metric ?? "count";
  const q = widget.kpi?.questionKey
    ? ctx.questions[widget.kpi.questionKey]
    : undefined;
  const stats = widget.kpi?.questionKey
    ? ctx.bundle.questions[widget.kpi.questionKey]
    : undefined;
  let value = "—";
  let label = t("addWidget.metrics.count");
  if (metric === "count") value = fmt.number(ctx.bundle.overview.total);
  else if (stats && "mean" in stats && stats.mean !== null) {
    if (metric === "average") {
      value = fmt.number(stats.mean, 2);
      label = `${t("widgets.average")}: ${q?.title ?? ""}`;
    } else if ("nps" in stats && stats.nps !== null) {
      value = fmt.number(stats.nps, 0);
      label = `${t("widgets.nps")}: ${q?.title ?? ""}`;
    }
  }
  return (
    <WidgetCard
      widget={widget}
      title={widget.title ?? label}
      help={t("help.kpi")}
      subtitle={
        stats
          ? t("widgets.answeredShort", { n: fmt.number(stats.n) })
          : undefined
      }
    >
      <p
        className={cn(
          "font-semibold tabular-nums",
          ctx.presenting ? "text-6xl" : "text-4xl",
        )}
      >
        {value}
      </p>
    </WidgetCard>
  );
}

export function TextWidget({ widget }: { widget: Widget }) {
  const { t } = useLabels();
  return (
    <WidgetCard widget={widget} title={widget.title ?? t("widgets.textBlock")}>
      <p className="text-sm whitespace-pre-line">
        {widget.text || (
          <span className="text-muted-foreground">
            {t("widgets.emptyText")}
          </span>
        )}
      </p>
    </WidgetCard>
  );
}

export function HeadingWidget({
  widget,
  sectionTitle,
}: {
  widget: Widget;
  sectionTitle?: string;
}) {
  const { t } = useLabels();
  const { editMode, updateWidget, removeWidget, presenting } = useDashboard();
  const [draft, setDraft] = useState<string | null>(null);
  const title =
    widget.title ??
    (widget.newGroup ? t("dashboard.newGroup") : sectionTitle) ??
    t("widgets.heading");
  return (
    <div
      className={cn(
        "flex h-full items-end gap-2 border-b pb-1",
        widget.hidden && "opacity-50",
      )}
      data-testid="widget-heading"
      data-widget-id={widget.id}
    >
      {editMode && (
        <span
          className="widget-drag cursor-grab text-muted-foreground"
          aria-hidden
        >
          ⋮⋮
        </span>
      )}
      {editMode && draft !== null ? (
        <input
          autoFocus
          className="bg-transparent text-lg font-semibold outline-none"
          value={draft}
          aria-label={t("widgets.rename")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            updateWidget(widget.id, { title: draft.trim() || undefined });
            setDraft(null);
          }}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.target as HTMLInputElement).blur()
          }
        />
      ) : (
        <h2
          className={cn(
            "font-semibold tracking-tight",
            presenting ? "text-2xl" : "text-lg",
          )}
        >
          {title}
        </h2>
      )}
      {editMode && (
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDraft(title)}>
            {t("widgets.rename")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateWidget(widget.id, { hidden: !widget.hidden })}
          >
            {widget.hidden ? t("widgets.show") : t("widgets.hide")}
          </Button>
          {widget.origin === "user" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeWidget(widget.id)}
            >
              {t("widgets.remove")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function WidgetSkeleton({ widget }: { widget: Widget }) {
  return (
    <div
      className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4"
      data-widget-id={widget.id}
    >
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="min-h-0 w-full flex-1" />
    </div>
  );
}

function EmptyChart() {
  const { t } = useLabels();
  return (
    <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t("insights.noData")}
    </p>
  );
}
