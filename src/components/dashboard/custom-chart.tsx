"use client";

import { AlertCircle } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import {
  BarChart,
  DataTable,
  DonutChart,
  SeriesChart,
} from "@/components/charts/charts";
import {
  BigNumber,
  MatrixChart,
  MultiBarChart,
  MultiSeriesChart,
  ScatterPlot,
} from "@/components/charts/custom-charts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildChartModel,
  dimensionLabel,
  EMPTY_ID,
  fieldLabel,
  metricLabel,
  type ChartLabeler,
  type ChartModel,
} from "@/lib/analytics/chart-result";
import {
  fieldType,
  specProblems,
  type ChartSpec,
} from "@/lib/analytics/chart-spec";
import type { Widget } from "@/lib/analytics/config";
import { toggleAnswerFilter } from "@/lib/analytics/filters";
import type { Question } from "@/lib/forms/schema";
import { useDashboard, useLabels } from "./dashboard-context";
import { useChartQuery } from "./use-dashboard-data";
import { WidgetCard, type CardBadge } from "./widget-card";

/** next-intl implementation of the chart labels. */
export function useChartLabeler(): ChartLabeler {
  const labels = useLabels();
  return useMemo(() => {
    const { t, format, fmt } = labels;
    const utc = (value: string) => {
      const [date, time] = value.split("T");
      const [y, m, d] = date.split("-").map(Number);
      const hour = time ? Number(time.slice(0, 2)) : 0;
      return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hour));
    };
    return {
      question: (key) => fmt.questionTitle(key),
      option: labels.optionLabel,
      meta: (field) => t(`chartBuilder.meta.${field}`),
      device: labels.deviceLabel,
      locale: labels.languageLabel,
      weekday: fmt.weekday,
      period: (value, grain) => {
        const date = utc(value);
        if (Number.isNaN(date.getTime())) return value;
        if (grain === "month")
          return format.dateTime(date, {
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          });
        const day = format.dateTime(date, {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });
        if (grain === "week") return t("chartBuilder.weekOf", { date: day });
        if (grain === "hour")
          return `${day} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
        return day;
      },
      agg: (agg) => t(`chartBuilder.aggs.${agg}`),
      number: (value, digits) => fmt.number(value, digits),
      empty: t("chartBuilder.noAnswer"),
    };
  }, [labels]);
}

/** Draws a chart model (shared by dashboard widgets and the builder preview). */
export const ChartBody = memo(function ChartBody({
  spec,
  model,
  title,
  presenting,
  onSelect,
}: {
  spec: ChartSpec;
  model: ChartModel;
  title: string;
  presenting?: boolean;
  /** Clicked category id (single-dimension charts). */
  onSelect?: (id: string) => void;
}) {
  const { t } = useLabels();
  const options = spec.options;
  switch (model.kind) {
    case "empty":
      return (
        <p className="flex h-full min-h-24 items-center justify-center text-sm text-muted-foreground">
          {t("insights.noData")}
        </p>
      );
    case "kpi":
      return (
        <BigNumber
          display={model.display}
          label={model.label}
          large={presenting}
        />
      );
    case "table":
      return (
        <DataTable
          columns={model.table.columns}
          rows={model.table.rows}
          className="h-full"
        />
      );
    case "scatter":
      return (
        <div className="flex h-full flex-col gap-1">
          <ScatterPlot
            points={model.points}
            xLabel={model.xLabel}
            yLabel={model.yLabel}
            ariaLabel={title}
          />
          <p className="text-xs text-muted-foreground">
            {t("chartBuilder.scatterCaption", {
              n: model.n,
              r: model.r === null ? "—" : model.r.toFixed(2),
            })}
          </p>
        </div>
      );
    case "matrix":
      return (
        <MatrixChart
          rows={model.rows}
          cols={model.cols}
          values={model.values}
          max={model.max}
          mode={spec.chart === "heatmap" ? "heatmap" : "pivot"}
          format={model.format}
          rowTitle={model.rowTitle}
          colTitle={model.colTitle}
          ariaLabel={title}
        />
      );
    case "multi": {
      const common = {
        categories: model.categories,
        series: model.series,
        values: model.values,
        format: model.format,
        palette: options.palette,
        showLegend: options.showLegend ?? true,
        ariaLabel: title,
      };
      if (spec.chart === "line" || spec.chart === "area")
        return (
          <MultiSeriesChart
            {...common}
            variant={spec.chart}
            stacked={options.stacked}
          />
        );
      return (
        <MultiBarChart
          {...common}
          orientation={spec.chart === "bar" ? "horizontal" : "vertical"}
          stacked={options.stacked}
          showValues={options.showValues}
        />
      );
    }
    case "single": {
      const data = model.items.map((it) => ({
        id: it.id,
        label: it.label,
        value: it.value,
        detail: `${model.metric}: ${it.display}`,
      }));
      const byValue = new Map(model.items.map((it) => [it.value, it.display]));
      const format = (value: number) => byValue.get(value) ?? String(value);
      const select = onSelect
        ? (d: { id: string }) => d.id !== EMPTY_ID && onSelect(d.id)
        : undefined;
      if (spec.chart === "donut")
        return (
          <DonutChart
            data={data}
            palette={options.palette ?? "categorical"}
            format={format}
            onSelect={select}
            ariaLabel={title}
          />
        );
      if (spec.chart === "line" || spec.chart === "area")
        return (
          <SeriesChart data={data} variant={spec.chart} ariaLabel={title} />
        );
      return (
        <BarChart
          data={data}
          palette={options.palette ?? "mono"}
          orientation={spec.chart === "bar" ? "horizontal" : "vertical"}
          format={format}
          showValues={options.showValues ?? true}
          onSelect={select}
          ariaLabel={title}
        />
      );
    }
  }
});

/** Default title from the spec ("Count by Department"). */
export function useSpecTitle() {
  const labeler = useChartLabeler();
  const { t } = useLabels();
  return useCallback(
    (spec: ChartSpec) => {
      if (spec.chart === "scatter")
        return spec.x && spec.y
          ? t("chartBuilder.titleScatter", {
              x: fieldLabel(spec.x, labeler),
              y: fieldLabel(spec.y, labeler),
            })
          : t("chartBuilder.untitled");
      const metric = spec.metrics[0]
        ? metricLabel(spec.metrics[0], labeler)
        : "";
      const dims = spec.dimensions.map((d) => dimensionLabel(d, labeler));
      if (!dims.length) return metric || t("chartBuilder.untitled");
      return t("chartBuilder.titleBy", { metric, dims: dims.join(" × ") });
    },
    [labeler, t],
  );
}

function useDrill(
  spec: ChartSpec | undefined,
  questions: Record<string, Question>,
) {
  const ctx = useDashboard();
  const dim = spec?.dimensions[0];
  if (
    !spec ||
    !dim ||
    !ctx.drillDown ||
    ctx.presenting ||
    spec.dimensions.length !== 1 ||
    dim.field.kind !== "question"
  )
    return undefined;
  const type = fieldType(dim.field, questions);
  if (type !== "category" && type !== "multi") return undefined;
  const key = dim.field.key;
  return (id: string) =>
    ctx.setFilters(toggleAnswerFilter(ctx.filters, key, id));
}

/** Dashboard widget for a chart builder chart (kind "custom"). */
export const CustomChartWidget = memo(function CustomChartWidget({
  widget,
}: {
  widget: Widget;
}) {
  const ctx = useDashboard();
  const labels = useLabels();
  const labeler = useChartLabeler();
  const specTitle = useSpecTitle();
  const { t, fmt } = labels;
  const spec = widget.custom;
  const problems = spec ? specProblems(spec, ctx.questions) : [];
  const query = useChartQuery(
    ctx.formId,
    widget.id,
    spec,
    ctx.rpcFilters,
    ctx.dataVersion,
    problems.length === 0,
  );
  const model = useMemo(
    () =>
      spec ? buildChartModel(spec, query.data, ctx.questions, labeler) : null,
    [spec, query.data, ctx.questions, labeler],
  );
  const drill = useDrill(spec, ctx.questions);
  if (!spec || !model) return null;
  const title = widget.title ?? specTitle(spec);

  const badges: CardBadge[] = [];
  if (spec.filters.length)
    badges.push({
      label: t("chartBuilder.filtersBadge", { count: spec.filters.length }),
    });
  const result = query.data;
  if (
    result?.kind === "grouped" &&
    spec.dimensions.length > 0 &&
    result.groups >
      (spec.dimensions.length === 1
        ? result.rows.length
        : new Set(result.rows.map((r) => r[0])).size)
  )
    badges.push({
      label: t("chartBuilder.topOf", {
        shown: fmt.number(
          spec.dimensions.length === 1
            ? result.rows.length
            : new Set(result.rows.map((r) => r[0])).size,
        ),
        total: fmt.number(result.groups),
      }),
      tone: "muted",
    });
  if (model.kind === "multi" && model.hiddenSeries > 0)
    badges.push({
      label: t("chartBuilder.hiddenSeries", { count: model.hiddenSeries }),
      tone: "muted",
    });
  if (widget.hidden) badges.push({ label: t("widgets.hidden"), tone: "muted" });

  const subtitle = result
    ? result.kind === "scatter"
      ? t("chartBuilder.subtitleScatter", {
          n: fmt.number(result.n),
          total: fmt.number(result.total),
        })
      : t("chartBuilder.subtitle", { total: fmt.number(result.total) })
    : undefined;

  let insight: string | null = null;
  if (
    model.kind === "single" &&
    model.items.length >= 2 &&
    spec.sort.by === "metric"
  ) {
    const top =
      spec.sort.dir === "desc"
        ? model.items[0]
        : model.items[model.items.length - 1];
    insight = t("chartBuilder.insightTop", {
      label: top.label,
      value: top.display,
    });
  } else if (model.kind === "scatter" && model.r !== null && model.n >= 3) {
    const r = Math.abs(model.r);
    insight = t("chartBuilder.insightCorrelation", {
      strength: t(
        `insights.strength.${r >= 0.5 ? "strong" : r >= 0.3 ? "moderate" : "weak"}`,
      ),
      direction: t(
        model.r >= 0 ? "chartBuilder.positive" : "chartBuilder.negative",
      ),
      r: fmt.number(model.r, 2),
    });
  }

  const textHidden =
    !ctx.textAnswers &&
    [
      ...spec.dimensions.map((d) => d.field),
      ...spec.filters.map((f) => f.field),
    ].some((f) => fieldType(f, ctx.questions) === "text");

  let body: React.ReactNode;
  if (problems.length)
    body = (
      <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4" aria-hidden />
        {t("chartBuilder.incomplete")}
      </p>
    );
  else if (textHidden)
    body = (
      <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("widgets.textHidden")}
      </p>
    );
  else if (query.isError)
    body = (
      <p className="flex h-full items-center justify-center gap-2 text-sm text-destructive">
        <AlertCircle className="size-4" aria-hidden />
        {t("chartBuilder.queryError")}
      </p>
    );
  else if (!result) body = <Skeleton className="h-full min-h-24 w-full" />;
  else
    body = (
      <ChartBody
        spec={spec}
        model={model}
        title={title}
        presenting={ctx.presenting}
        onSelect={drill}
      />
    );

  return (
    <WidgetCard
      widget={widget}
      title={title}
      subtitle={subtitle}
      badges={badges}
      insight={insight}
      help={t(`chartBuilder.help.${spec.chart}`)}
      table={
        model.kind !== "table" &&
        model.kind !== "empty" &&
        model.table.rows.length
          ? model.table
          : null
      }
    >
      {body}
    </WidgetCard>
  );
});
