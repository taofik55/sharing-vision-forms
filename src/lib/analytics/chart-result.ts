/**
 * Turns a dashboard_query result into what a chart draws: labelled
 * categories, series, matrices and an accessible data table. Pure (labels
 * come from a ChartLabeler), so the builder preview, dashboard widgets and
 * tests share one implementation.
 */
import type { Question } from "@/lib/forms/schema";
import {
  fieldType,
  type Aggregation,
  type ChartSpec,
  type Dimension,
  type FieldRef,
  type FieldType,
  type MetaField,
  type Metric,
  type TimeGrain,
} from "./chart-spec";

export type GroupedResult = {
  kind: "grouped";
  rows: (string | number | null)[][];
  total: number;
  groups: number;
  bins: Record<string, { lo: number; hi: number; n: number }>;
};
export type ScatterResult = {
  kind: "scatter";
  total: number;
  n: number;
  r: number | null;
  points: [number, number][];
};
export type ChartQueryResult = GroupedResult | ScatterResult;

/** Locale-aware labels (implemented with next-intl in the UI, plain in tests). */
export type ChartLabeler = {
  question: (key: string) => string;
  option: (questionKey: string, optionId: string) => string;
  meta: (field: MetaField) => string;
  device: (value: string) => string;
  locale: (value: string) => string;
  weekday: (isoDow: number) => string;
  /** "YYYY-MM-DD", "YYYY-MM" or "YYYY-MM-DDTHH:00" for a grain. */
  period: (value: string, grain: TimeGrain) => string;
  agg: (agg: Aggregation) => string;
  /** Locale number with at most `digits` decimals. */
  number: (value: number, digits: number) => string;
  /** "(no answer)" */
  empty: string;
};

export type Item = { id: string; label: string };

/** Id used for "no answer" groups (includeEmpty). */
export const EMPTY_ID = "__empty";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function fieldLabel(ref: FieldRef, labeler: ChartLabeler): string {
  return ref.kind === "question"
    ? labeler.question(ref.key)
    : labeler.meta(ref.field);
}

export function dimensionLabel(dim: Dimension, labeler: ChartLabeler): string {
  return dim.label?.trim() || fieldLabel(dim.field, labeler);
}

export function metricLabel(metric: Metric, labeler: ChartLabeler): string {
  if (metric.label?.trim()) return metric.label.trim();
  const agg = labeler.agg(metric.agg);
  return metric.field ? `${agg} · ${fieldLabel(metric.field, labeler)}` : agg;
}

/** Digits worth showing for a bin edge (whole numbers stay whole). */
function edgeDigits(lo: number, hi: number, n: number): number {
  const width = (hi - lo) / n;
  if (Number.isInteger(lo) && Number.isInteger(width)) return 0;
  return width >= 10 ? 0 : width >= 1 ? 1 : 2;
}

export function binRange(
  bucket: number,
  bin: { lo: number; hi: number; n: number },
): { from: number; to: number } {
  if (bin.hi <= bin.lo) return { from: bin.lo, to: bin.hi };
  const width = (bin.hi - bin.lo) / bin.n;
  return {
    from: bin.lo + (bucket - 1) * width,
    to: bucket === bin.n ? bin.hi : bin.lo + bucket * width,
  };
}

/** Label of one dimension value as returned by dashboard_query. */
export function valueLabel(
  value: string | number | null,
  dim: Dimension,
  type: FieldType | null,
  bin: { lo: number; hi: number; n: number } | undefined,
  labeler: ChartLabeler,
): string {
  if (value === null || value === "") return labeler.empty;
  const text = String(value);
  if (bin) {
    const { from, to } = binRange(Number(text), bin);
    const digits = edgeDigits(bin.lo, bin.hi, bin.n);
    if (from === to) return labeler.number(from, digits);
    return `${labeler.number(from, digits)}–${labeler.number(to, digits)}`;
  }
  const ref = dim.field;
  if (ref.kind === "meta") {
    if (ref.field === "device") return labeler.device(text);
    if (ref.field === "locale") return labeler.locale(text);
    if (ref.field === "version") return `v${text}`;
    if (ref.field === "duration") return labeler.number(Number(text), 0);
  }
  if (type === "category" || type === "multi")
    return ref.kind === "question" ? labeler.option(ref.key, text) : text;
  if (type === "number") return labeler.number(Number(text), 2);
  if (type === "time" || type === "date") {
    const grain = dim.grain ?? "day";
    if (grain === "weekday") return labeler.weekday(Number(text));
    if (grain === "hour_of_day") return `${text.padStart(2, "0")}:00`;
    return labeler.period(text, grain);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export type NumberFormat = NonNullable<ChartSpec["options"]["format"]>;

const PERCENT_AGGS: readonly Aggregation[] = ["percent", "csat"];

export function formatValue(
  value: number | null | undefined,
  metric: Metric,
  format: NumberFormat | undefined,
  labeler: ChartLabeler,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const mode = format ?? "auto";
  if (mode === "integer") return labeler.number(Math.round(value), 0);
  if (mode === "decimal") return labeler.number(value, 2);
  if (mode === "percent") return `${labeler.number(value, 1)}%`;
  if (PERCENT_AGGS.includes(metric.agg)) return `${labeler.number(value, 1)}%`;
  if (metric.agg === "count") return labeler.number(value, 0);
  if (metric.agg === "nps") return labeler.number(value, 1);
  return labeler.number(value, 2);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export type DataTableModel = { columns: string[]; rows: (string | number)[][] };

export type ChartModel =
  | { kind: "empty"; table: DataTableModel }
  | {
      kind: "kpi";
      value: number | null;
      display: string;
      label: string;
      table: DataTableModel;
    }
  | {
      /** One dimension, one metric. */
      kind: "single";
      items: (Item & { value: number; display: string })[];
      metric: string;
      table: DataTableModel;
    }
  | {
      /** Two dimensions: categories (dim 0) x series (dim 1). */
      kind: "multi";
      categories: Item[];
      series: Item[];
      /** Series beyond the 8 colour slots (still listed in the table). */
      hiddenSeries: number;
      /** values[category][series] */
      values: (number | null)[][];
      metric: string;
      format: (value: number) => string;
      table: DataTableModel;
    }
  | {
      kind: "matrix";
      rows: Item[];
      cols: Item[];
      values: (number | null)[][];
      max: number;
      rowTitle: string;
      colTitle: string;
      metric: string;
      format: (value: number) => string;
      table: DataTableModel;
    }
  | { kind: "table"; table: DataTableModel }
  | {
      kind: "scatter";
      points: [number, number][];
      r: number | null;
      n: number;
      xLabel: string;
      yLabel: string;
      table: DataTableModel;
    };

export const MAX_SERIES = 8;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function itemId(value: string | number | null): string {
  return value === null || value === "" ? EMPTY_ID : String(value);
}

/**
 * Stable series order: answer options follow the form's option order (so a
 * colour stays with its option when filters change); other values keep the
 * server order (ascending).
 */
function orderSeries(
  ids: string[],
  dim: Dimension,
  questions: Record<string, Question>,
): string[] {
  const ref = dim.field;
  const options =
    ref.kind === "question" ? questions[ref.key]?.options : undefined;
  if (!options?.length) return ids;
  const rank = new Map(options.map((o, i) => [o.id, i]));
  return [...ids].sort(
    (a, b) =>
      (a === EMPTY_ID ? 1e6 : (rank.get(a) ?? 1e5)) -
      (b === EMPTY_ID ? 1e6 : (rank.get(b) ?? 1e5)),
  );
}

export function buildChartModel(
  spec: ChartSpec,
  result: ChartQueryResult | undefined,
  questions: Record<string, Question>,
  labeler: ChartLabeler,
): ChartModel {
  const empty: ChartModel = {
    kind: "empty",
    table: { columns: [], rows: [] },
  };
  if (!result) return empty;

  if (result.kind === "scatter") {
    if (!spec.x || !spec.y) return empty;
    const xLabel = fieldLabel(spec.x, labeler);
    const yLabel = fieldLabel(spec.y, labeler);
    return {
      kind: "scatter",
      points: result.points,
      r: result.r,
      n: result.n,
      xLabel,
      yLabel,
      table: {
        columns: [xLabel, yLabel],
        rows: result.points
          .slice(0, 500)
          .map(([x, y]) => [labeler.number(x, 2), labeler.number(y, 2)]),
      },
    };
  }

  const dims = spec.dimensions;
  const metrics = spec.metrics;
  const fmt = spec.options.format;
  const types = dims.map((d) => fieldType(d.field, questions));
  const dimLabels = dims.map((d) => dimensionLabel(d, labeler));
  const metricLabels = metrics.map((m) => metricLabel(m, labeler));
  const label = (value: string | number | null, i: number) =>
    valueLabel(value, dims[i], types[i], result.bins[String(i)], labeler);
  const show = (value: number | null, m = 0) =>
    formatValue(value, metrics[m], fmt, labeler);

  const table: DataTableModel = {
    columns: [...dimLabels, ...metricLabels],
    rows: result.rows.map((row) => [
      ...dims.map((_, i) => label(row[i] ?? null, i)),
      ...metrics.map((_, m) => show(num(row[dims.length + m]), m)),
    ]),
  };

  if (spec.chart === "table") return { kind: "table", table };
  if (!result.rows.length) return { ...empty, table };

  if (dims.length === 0) {
    const value = num(result.rows[0]?.[0]);
    return {
      kind: "kpi",
      value,
      display: show(value),
      label: metricLabels[0] ?? "",
      table,
    };
  }

  if (dims.length === 1) {
    let rows = result.rows;
    // Histograms (and any binned dimension sorted by range) show empty bins.
    const bin = result.bins["0"];
    if (bin && spec.sort.by === "dimension" && metrics[0]?.agg === "count") {
      const byBucket = new Map(rows.map((r) => [String(r[0]), r]));
      const buckets = Array.from(
        { length: bin.hi > bin.lo ? bin.n : 1 },
        (_, i) => String(i + 1),
      );
      if (spec.sort.dir === "desc") buckets.reverse();
      rows = [
        ...buckets.map((b) => byBucket.get(b) ?? [b, 0]),
        ...rows.filter((r) => r[0] === null),
      ];
    }
    const items = rows.map((row) => {
      const value = num(row[1]) ?? 0;
      return {
        id: itemId(row[0] ?? null),
        label: label(row[0] ?? null, 0),
        value,
        display: show(value),
      };
    });
    return {
      kind: "single",
      items,
      metric: metricLabels[0] ?? "",
      table: {
        ...table,
        rows: items.map((it, i) => [
          it.label,
          ...metrics.map((_, m) => show(num(rows[i]?.[1 + m] ?? null), m)),
        ]),
      },
    };
  }

  // Two dimensions.
  const catIds: string[] = [];
  const cats = new Map<string, Item>();
  const serIds: string[] = [];
  const sers = new Map<string, Item>();
  const cell = new Map<string, number | null>();
  for (const row of result.rows) {
    const c = itemId(row[0] ?? null);
    const s = itemId(row[1] ?? null);
    if (!cats.has(c)) {
      cats.set(c, { id: c, label: label(row[0] ?? null, 0) });
      catIds.push(c);
    }
    if (!sers.has(s)) {
      sers.set(s, { id: s, label: label(row[1] ?? null, 1) });
      serIds.push(s);
    }
    cell.set(`${c}\u0000${s}`, num(row[2]));
  }
  const ordered = orderSeries(serIds, dims[1], questions);
  const values = (series: string[]) =>
    catIds.map((c) => series.map((s) => cell.get(`${c}\u0000${s}`) ?? null));
  const format = (value: number) => show(value);

  if (spec.chart === "pivot" || spec.chart === "heatmap") {
    const matrix = values(ordered);
    return {
      kind: "matrix",
      rows: catIds.map((c) => cats.get(c)!),
      cols: ordered.map((s) => sers.get(s)!),
      values: matrix,
      max: matrix.flat().reduce<number>((m, v) => Math.max(m, v ?? 0), 0),
      rowTitle: dimLabels[0],
      colTitle: dimLabels[1],
      metric: metricLabels[0] ?? "",
      format,
      table,
    };
  }

  // Colour slots: keep the 8 largest series (by total), in stable order.
  let visible = ordered;
  if (ordered.length > MAX_SERIES) {
    const totals = new Map(
      ordered.map((s) => [
        s,
        catIds.reduce((a, c) => a + (cell.get(`${c}\u0000${s}`) ?? 0), 0),
      ]),
    );
    const keep = new Set(
      [...ordered]
        .sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))
        .slice(0, MAX_SERIES),
    );
    visible = ordered.filter((s) => keep.has(s));
  }
  return {
    kind: "multi",
    categories: catIds.map((c) => cats.get(c)!),
    series: visible.map((s) => sers.get(s)!),
    hiddenSeries: ordered.length - visible.length,
    values: values(visible),
    metric: metricLabels[0] ?? "",
    format,
    table,
  };
}
