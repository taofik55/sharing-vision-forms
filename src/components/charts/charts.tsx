"use client";

/**
 * Chart primitives (Recharts). Mark specs follow the dataviz reference:
 * bars <= 24 px with 4 px rounded data-ends, 2 px lines, >= 8 px markers,
 * area fill ~10% opacity, hairline recessive grid, text in text tokens,
 * selective value labels, a hover tooltip on every mark. Memoized: charts
 * re-render only when their data changes, and animate between values.
 */
import { memo, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart as RLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
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

export type Datum = {
  id: string;
  label: string;
  value: number;
  /** Optional secondary text in tooltips. */ detail?: string;
};

/**
 * Recharts 3.10 entry animations never start under React StrictMode double
 * mounting (dev only): marks stay invisible. Production does not double-mount,
 * so charts animate there; in development they render without animation.
 */
const ANIMATE = process.env.NODE_ENV === "production";

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const GRID = "var(--chart-grid)";

function TooltipBox({
  active,
  payload,
}: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const datum = item.payload as Datum | undefined;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ background: (item.color as string) ?? "var(--series-1)" }}
          aria-hidden
        />
        <span className="font-medium">{datum?.label ?? item.name}</span>
      </div>
      <div className="mt-1 text-muted-foreground tabular-nums">
        {datum?.detail ?? item.value}
      </div>
    </div>
  );
}

type BaseProps = {
  data: Datum[];
  palette?: PaletteId;
  height?: number;
  onSelect?: (datum: Datum) => void;
  /** Formats values for labels. */
  format?: (value: number) => string;
  ariaLabel: string;
};

/** Donut for parts of a whole (<= 5 options). Legend with labels + shares. */
export const DonutChart = memo(function DonutChart({
  data,
  palette = "categorical",
  height = 220,
  onSelect,
  format = String,
  ariaLabel,
}: BaseProps) {
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <div
      className="flex h-full flex-col gap-3 sm:flex-row sm:items-center"
      // Clickable legend rows are buttons, which an img role would hide.
      role={onSelect ? "group" : "img"}
      aria-label={ariaLabel}
    >
      <div
        className="min-h-0 flex-1"
        style={{ minHeight: Math.min(height, 200) }}
      >
        <ResponsiveContainer width="100%" height="100%" minHeight={160}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={data.length > 1 ? 1 : 0}
              stroke="var(--card)"
              strokeWidth={2}
              onClick={(d) => onSelect?.(d.payload as Datum)}
              className={onSelect ? "cursor-pointer" : undefined}
              isAnimationActive={ANIMATE}
            >
              {data.map((d, i) => (
                <Cell key={d.id} fill={colorAt(i, palette, data.length)} />
              ))}
            </Pie>
            <Tooltip content={TooltipBox} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5 text-sm sm:w-[45%]">
        {data.map((d, i) => (
          <li key={d.id}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(d)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: colorAt(i, palette, data.length) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {format(d.value)}
                {total > 0 && <> · {Math.round((d.value / total) * 100)}%</>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Bars: horizontal (default, for many / long labels) or vertical columns. */
export const BarChart = memo(function BarChart({
  data,
  palette = "mono",
  orientation = "horizontal",
  onSelect,
  format = String,
  ariaLabel,
  valueSuffix = "",
  showValues = true,
}: BaseProps & {
  orientation?: "horizontal" | "vertical";
  valueSuffix?: string;
  showValues?: boolean;
}) {
  const horizontal = orientation === "horizontal";
  const decimals = data.some((d) => !Number.isInteger(d.value));
  const longest = data.reduce((m, d) => Math.max(m, d.label.length), 0);
  const labelWidth = Math.min(180, Math.max(48, longest * 7));
  return (
    <div className="h-full min-h-40 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%" minHeight={160}>
        <RBarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 16, right: horizontal ? 48 : 8, bottom: 4, left: 4 }}
          barCategoryGap={horizontal ? "22%" : "18%"}
        >
          <CartesianGrid
            stroke={GRID}
            strokeWidth={1}
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
                  // Every label only while they fit side by side.
                  data.length > 12 || data.length * longest > 60
                    ? "preserveStartEnd"
                    : 0
                }
                minTickGap={4}
              />
              <YAxis
                type="number"
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                allowDecimals={decimals}
                width={40}
              />
            </>
          )}
          <Tooltip
            content={TooltipBox}
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          />
          <Bar
            dataKey="value"
            maxBarSize={24}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            onClick={(d) => onSelect?.(d.payload as Datum)}
            className={onSelect ? "cursor-pointer" : undefined}
            isAnimationActive={ANIMATE}
          >
            {data.map((d, i) => (
              <Cell key={d.id} fill={colorAt(i, palette, data.length)} />
            ))}
            {showValues && (
              <LabelList
                dataKey="value"
                position={horizontal ? "right" : "top"}
                className="fill-muted-foreground text-xs tabular-nums"
                formatter={(v: unknown) => `${format(Number(v))}${valueSuffix}`}
              />
            )}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Time series / ordered series as a 2 px line or a line with a 10% area wash. */
export const SeriesChart = memo(function SeriesChart({
  data,
  variant = "area",
  ariaLabel,
}: Pick<BaseProps, "data" | "ariaLabel"> & { variant?: "area" | "line" }) {
  const Chart = variant === "area" ? AreaChart : RLineChart;
  const decimals = data.some((d) => !Number.isInteger(d.value));
  return (
    <div className="h-full min-h-40 w-full" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%" minHeight={160}>
        <Chart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
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
          />
          <Tooltip
            content={TooltipBox}
            cursor={{ stroke: "var(--chart-axis)" }}
          />
          {variant === "area" ? (
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="var(--series-1)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={ANIMATE}
            />
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              dot={
                data.length <= 24
                  ? {
                      r: 4,
                      fill: "var(--series-1)",
                      stroke: "var(--card)",
                      strokeWidth: 2,
                    }
                  : false
              }
              activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={ANIMATE}
            />
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
});

/** Weekday x hour heatmap (sequential ramp), with a hover title per cell. */
export const Heatmap = memo(function Heatmap({
  cells,
  dayLabel,
  cellTitle,
  ariaLabel,
}: {
  cells: { dow: number; hour: number; count: number }[];
  dayLabel: (dow: number) => string;
  cellTitle: (dow: number, hour: number, count: number) => string;
  ariaLabel: string;
}) {
  const max = cells.reduce((m, c) => Math.max(m, c.count), 0);
  const lookup = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.count]));
  return (
    <div
      className="flex h-full flex-col gap-1 overflow-x-auto"
      role="img"
      // Scrollable on small screens: keyboard users must be able to scroll it.
      tabIndex={0}
      aria-label={ariaLabel}
    >
      <div className="grid min-w-[560px] grid-cols-[3rem_repeat(24,minmax(0,1fr))] gap-[2px]">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span
            key={h}
            className="text-center text-[10px] text-muted-foreground tabular-nums"
          >
            {h % 3 === 0 ? h : ""}
          </span>
        ))}
        {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
          <Row key={dow} dow={dow} />
        ))}
      </div>
    </div>
  );

  function Row({ dow }: { dow: number }): ReactNode {
    return (
      <>
        <span className="pr-1 text-right text-xs leading-5 text-muted-foreground">
          {dayLabel(dow)}
        </span>
        {Array.from({ length: 24 }, (_, hour) => {
          const count = lookup.get(`${dow}:${hour}`) ?? 0;
          return (
            <span
              key={hour}
              title={cellTitle(dow, hour, count)}
              className="h-5 rounded-[3px]"
              style={{ background: heatColor(max ? count / max : 0) }}
            />
          );
        })}
      </>
    );
  }
});

/** Plain data table: the accessible fallback for every chart. */
export const DataTable = memo(function DataTable({
  columns,
  rows,
  className,
}: {
  columns: string[];
  rows: (string | number)[][];
  className?: string;
}) {
  return (
    <div
      className={cn("max-h-full overflow-auto rounded-md border", className)}
    >
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "px-3 py-1.5 text-left font-medium",
                  i > 0 && "text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-3 py-1.5",
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
});

/** Stat tiles: label + value (+ optional delta). */
export function StatGrid({
  items,
}: {
  items: { label: string; value: string; hint?: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md bg-muted/40 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
          {item.hint && (
            <dd className="text-xs text-muted-foreground">{item.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
