"use client";

/**
 * Chart builder primitives: multi-series bars / lines / areas, matrices
 * (pivot table and heatmap), scatter and a big-number KPI. Same mark specs
 * as charts.tsx; series colours follow the fixed categorical order, and every
 * chart with two or more series carries a legend.
 */
import { memo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import type { PaletteId } from "@/lib/analytics/config";
import { cn } from "@/lib/utils";
import { colorAt, heatColor } from "./palette";

const ANIMATE = process.env.NODE_ENV === "production";
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const GRID = "var(--chart-grid)";

export type SeriesItem = { id: string; label: string };

type MultiProps = {
  categories: SeriesItem[];
  series: SeriesItem[];
  /** values[category][series] */
  values: (number | null)[][];
  format: (value: number) => string;
  palette?: PaletteId;
  showLegend?: boolean;
  ariaLabel: string;
};

function seriesColor(i: number, palette: PaletteId | undefined, n: number) {
  // A single series is one colour; "mono" across many series would hide identity.
  if (n <= 1) return "var(--series-1)";
  return colorAt(i, palette === "sequential" ? "sequential" : "categorical", n);
}

function toRows(
  categories: SeriesItem[],
  series: SeriesItem[],
  values: (number | null)[][],
) {
  return categories.map((c, ci) => {
    const row: Record<string, string | number | null> = { label: c.label };
    series.forEach((_, si) => {
      row[`s${si}`] = values[ci]?.[si] ?? null;
    });
    return row;
  });
}

function hasDecimals(values: (number | null)[][]) {
  return values.some((r) => r.some((v) => v !== null && !Number.isInteger(v)));
}

export function Legend({
  items,
  className,
}: {
  items: { id: string; label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
      data-testid="chart-legend"
    >
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
            aria-hidden
          />
          <span className="max-w-48 truncate" title={item.label}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function multiTooltip(format: (value: number) => string) {
  return function MultiTooltip({
    active,
    payload,
    label,
  }: TooltipContentProps<ValueType, NameType>) {
    if (!active || !payload?.length) return null;
    return (
      <div className="max-w-72 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
        <p className="mb-1 font-medium">{String(label ?? "")}</p>
        <ul className="flex flex-col gap-0.5">
          {payload
            .filter((p) => p.value !== null && p.value !== undefined)
            .map((p) => (
              <li key={String(p.dataKey)} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: p.color as string }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {format(Number(p.value))}
                </span>
              </li>
            ))}
        </ul>
      </div>
    );
  };
}

/** Grouped or stacked bars (categories x series). */
export const MultiBarChart = memo(function MultiBarChart({
  categories,
  series,
  values,
  format,
  palette,
  showLegend = true,
  orientation = "vertical",
  stacked,
  showValues,
  ariaLabel,
}: MultiProps & {
  orientation?: "horizontal" | "vertical";
  stacked?: boolean;
  showValues?: boolean;
}) {
  const horizontal = orientation === "horizontal";
  const rows = toRows(categories, series, values);
  const longest = categories.reduce((m, c) => Math.max(m, c.label.length), 0);
  const labelWidth = Math.min(180, Math.max(48, longest * 7));
  const decimals = hasDecimals(values);
  const colors = series.map((_, i) => seriesColor(i, palette, series.length));
  const valueAxis = (
    <YAxis
      type="number"
      tick={AXIS_TICK}
      axisLine={false}
      tickLine={false}
      allowDecimals={decimals}
      width={40}
      tickFormatter={(v: number) => format(v)}
    />
  );
  return (
    <div className="flex h-full min-h-40 w-full flex-col gap-2">
      <div className="min-h-0 flex-1" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" minHeight={150}>
          <RBarChart
            data={rows}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 16, right: horizontal ? 40 : 8, bottom: 4, left: 4 }}
            barCategoryGap="20%"
            barGap={2}
          >
            <CartesianGrid
              stroke={GRID}
              horizontal={!horizontal}
              vertical={horizontal}
            />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={decimals}
                  tickFormatter={(v: number) => format(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={labelWidth}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
              </>
            ) : (
              <>
                <XAxis
                  type="category"
                  dataKey="label"
                  tick={AXIS_TICK}
                  axisLine={{ stroke: "var(--chart-axis)" }}
                  tickLine={false}
                  interval={
                    categories.length > 12 || categories.length * longest > 60
                      ? "preserveStartEnd"
                      : 0
                  }
                  minTickGap={4}
                />
                {valueAxis}
              </>
            )}
            <Tooltip
              content={multiTooltip(format)}
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            />
            {series.map((s, i) => {
              const last = i === series.length - 1;
              const radius: [number, number, number, number] =
                stacked && !last
                  ? [0, 0, 0, 0]
                  : horizontal
                    ? [0, 4, 4, 0]
                    : [4, 4, 0, 0];
              return (
                <Bar
                  key={s.id}
                  dataKey={`s${i}`}
                  name={s.label}
                  stackId={stacked ? "a" : undefined}
                  fill={colors[i]}
                  stroke="var(--card)"
                  strokeWidth={stacked ? 1 : 0}
                  maxBarSize={stacked ? 32 : 20}
                  radius={radius}
                  isAnimationActive={ANIMATE}
                >
                  {showValues && (!stacked || last) && series.length <= 4 && (
                    <LabelList
                      dataKey={`s${i}`}
                      position={horizontal ? "right" : "top"}
                      className="fill-muted-foreground text-[11px] tabular-nums"
                      formatter={(v: unknown) =>
                        v === null || v === undefined ? "" : format(Number(v))
                      }
                    />
                  )}
                </Bar>
              );
            })}
          </RBarChart>
        </ResponsiveContainer>
      </div>
      {showLegend && series.length > 1 && (
        <Legend items={series.map((s, i) => ({ ...s, color: colors[i] }))} />
      )}
    </div>
  );
});

/** Several lines (or stacked / overlapping areas) over ordered categories. */
export const MultiSeriesChart = memo(function MultiSeriesChart({
  categories,
  series,
  values,
  format,
  palette,
  showLegend = true,
  variant = "line",
  stacked,
  ariaLabel,
}: MultiProps & { variant?: "line" | "area"; stacked?: boolean }) {
  const rows = toRows(categories, series, values);
  const decimals = hasDecimals(values);
  const colors = series.map((_, i) => seriesColor(i, palette, series.length));
  const Chart = variant === "area" ? AreaChart : RLineChart;
  return (
    <div className="flex h-full min-h-40 w-full flex-col gap-2">
      <div className="min-h-0 flex-1" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" minHeight={150}>
          <Chart
            data={rows}
            margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={decimals}
              width={40}
              tickFormatter={(v: number) => format(v)}
            />
            <Tooltip
              content={multiTooltip(format)}
              cursor={{ stroke: "var(--chart-axis)" }}
            />
            {series.map((s, i) =>
              variant === "area" ? (
                <Area
                  key={s.id}
                  type="monotone"
                  dataKey={`s${i}`}
                  name={s.label}
                  stackId={stacked ? "a" : undefined}
                  stroke={colors[i]}
                  strokeWidth={2}
                  fill={colors[i]}
                  fillOpacity={stacked ? 0.35 : 0.1}
                  dot={false}
                  connectNulls
                  activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={ANIMATE}
                />
              ) : (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={`s${i}`}
                  name={s.label}
                  stroke={colors[i]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  connectNulls
                  dot={
                    categories.length <= 24
                      ? {
                          r: 4,
                          fill: colors[i],
                          stroke: "var(--card)",
                          strokeWidth: 2,
                        }
                      : false
                  }
                  activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={ANIMATE}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
      {showLegend && series.length > 1 && (
        <Legend items={series.map((s, i) => ({ ...s, color: colors[i] }))} />
      )}
    </div>
  );
});

/**
 * Matrix of two dimensions: "heatmap" colours every cell on the sequential
 * ramp; "pivot" is a table with a light wash. Values are always printed, so
 * colour is never the only carrier.
 */
export const MatrixChart = memo(function MatrixChart({
  rows,
  cols,
  values,
  max,
  mode,
  format,
  rowTitle,
  colTitle,
  ariaLabel,
}: {
  rows: SeriesItem[];
  cols: SeriesItem[];
  values: (number | null)[][];
  max: number;
  mode: "heatmap" | "pivot";
  format: (value: number) => string;
  rowTitle: string;
  colTitle: string;
  ariaLabel: string;
}) {
  return (
    <div
      className="h-full overflow-auto rounded-md border"
      tabIndex={0}
      aria-label={ariaLabel}
      data-testid={`matrix-${mode}`}
    >
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 border-b bg-card px-2 py-1.5 text-left font-medium text-muted-foreground"
            >
              {rowTitle} \ {colTitle}
            </th>
            {cols.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="max-w-32 truncate border-b px-2 py-1.5 text-right font-medium"
                title={c.label}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.id}>
              <th
                scope="row"
                className="sticky left-0 max-w-48 truncate border-b bg-card px-2 py-1.5 text-left font-medium"
                title={r.label}
              >
                {r.label}
              </th>
              {cols.map((c, ci) => {
                const v = values[ri]?.[ci] ?? null;
                const ratio = v !== null && max > 0 ? v / max : 0;
                const strong = mode === "heatmap" && ratio > 0.55;
                return (
                  <td
                    key={c.id}
                    title={`${r.label} · ${c.label}: ${v === null ? "—" : format(v)}`}
                    className={cn(
                      "border-b px-2 py-1.5 text-right tabular-nums",
                      mode === "heatmap" && "border-2 border-card",
                      strong && "text-white dark:text-slate-950",
                    )}
                    style={{
                      background:
                        v === null
                          ? undefined
                          : mode === "heatmap"
                            ? heatColor(ratio)
                            : `color-mix(in oklab, var(--series-1) ${Math.round(ratio * 22)}%, transparent)`,
                    }}
                  >
                    {v === null ? "—" : format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/** One point per response; r is Pearson's correlation. */
export const ScatterPlot = memo(function ScatterPlot({
  points,
  xLabel,
  yLabel,
  ariaLabel,
}: {
  points: [number, number][];
  xLabel: string;
  yLabel: string;
  ariaLabel: string;
}) {
  const data = points.map(([x, y]) => ({ x, y }));
  return (
    <div className="h-full min-h-40 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%" minHeight={150}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={AXIS_TICK}
            axisLine={{ stroke: "var(--chart-axis)" }}
            tickLine={false}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -10,
              fill: "var(--muted-foreground)",
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            width={40}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          <Scatter
            data={data}
            fill="var(--series-1)"
            fillOpacity={0.55}
            isAnimationActive={ANIMATE}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Headline number (KPI). */
export function BigNumber({
  display,
  label,
  large,
}: {
  display: string;
  label: string;
  large?: boolean;
}) {
  return (
    <div className="flex h-full flex-col justify-center">
      <p
        className={cn(
          "font-semibold tracking-tight tabular-nums",
          large ? "text-6xl" : "text-4xl",
        )}
        data-testid="kpi-value"
      >
        {display}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
