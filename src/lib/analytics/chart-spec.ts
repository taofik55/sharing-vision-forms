/**
 * Custom chart specification (chart builder). One Zod schema shared by the
 * builder, the dashboard renderer and the server: the dashboard_query RPC
 * re-validates every reference against the form, so a spec can only read
 * aggregates of its own form.
 */
import { z } from "zod";
import type { Question, QuestionType } from "@/lib/forms/schema";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const META_FIELDS = [
  "submitted_at",
  "device",
  "locale",
  "version",
  "duration",
] as const;
export type MetaField = (typeof META_FIELDS)[number];

export const fieldSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), key }),
  z.object({ kind: z.literal("meta"), field: z.enum(META_FIELDS) }),
]);
export type FieldRef = z.infer<typeof fieldSchema>;

export const TIME_GRAINS = [
  "hour",
  "day",
  "week",
  "month",
  "weekday",
  "hour_of_day",
] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

export const dimensionSchema = z.object({
  field: fieldSchema,
  /** Dates and submission time. */
  grain: z.enum(TIME_GRAINS).optional(),
  /** Numbers / duration: equal-width ranges instead of exact values. */
  bins: z.number().int().min(2).max(50).optional(),
  label: z.string().max(100).optional(),
});
export type Dimension = z.infer<typeof dimensionSchema>;

export const AGGREGATIONS = [
  "count",
  "percent",
  "avg",
  "median",
  "min",
  "max",
  "sum",
  "nps",
  "csat",
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const metricSchema = z.object({
  agg: z.enum(AGGREGATIONS),
  /** Numeric question or duration; not used by count / percent. */
  field: fieldSchema.optional(),
  label: z.string().max(100).optional(),
});
export type Metric = z.infer<typeof metricSchema>;

export const FILTER_OPS = [
  "in",
  "not_in",
  "gt",
  "lt",
  "is_answered",
  "is_empty",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const chartFilterSchema = z.object({
  field: fieldSchema,
  op: z.enum(FILTER_OPS),
  values: z
    .array(z.union([z.string().max(200), z.number()]))
    .max(50)
    .optional(),
});
export type ChartFilter = z.infer<typeof chartFilterSchema>;

export const CUSTOM_CHARTS = [
  "kpi",
  "bar",
  "column",
  "line",
  "area",
  "donut",
  "table",
  "pivot",
  "heatmap",
  "scatter",
  "histogram",
] as const;
export type CustomChart = (typeof CUSTOM_CHARTS)[number];

export const NUMBER_FORMATS = [
  "auto",
  "integer",
  "decimal",
  "percent",
] as const;

export const chartSpecSchema = z.object({
  chart: z.enum(CUSTOM_CHARTS),
  dimensions: z.array(dimensionSchema).max(2),
  metrics: z.array(metricSchema).max(5),
  filters: z.array(chartFilterSchema).max(10),
  sort: z.object({
    by: z.enum(["metric", "dimension"]),
    dir: z.enum(["asc", "desc"]),
  }),
  limit: z.number().int().min(1).max(500),
  /** Scatter: one point per response (two numeric fields). */
  x: fieldSchema.optional(),
  y: fieldSchema.optional(),
  options: z.object({
    stacked: z.boolean().optional(),
    showValues: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    palette: z.enum(["categorical", "sequential", "mono"]).optional(),
    format: z.enum(NUMBER_FORMATS).optional(),
    /** Include responses without an answer as a "(no answer)" group. */
    includeEmpty: z.boolean().optional(),
  }),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

// ---------------------------------------------------------------------------
// Slots: what each chart needs (drives the builder and validation)
// ---------------------------------------------------------------------------

export type SlotId = "dim0" | "dim1" | "metrics" | "x" | "y";

export type ChartShape = {
  /** Dimension slots in order (0, 1 or 2). */
  dims: { min: number; max: number };
  metrics: { min: number; max: number };
  /** Scatter uses x / y fields instead of dimensions and metrics. */
  xy?: true;
  /** Histogram: one numeric dimension, always binned. */
  numericDim?: true;
  stackable?: true;
};

export const CHART_SHAPES: Record<CustomChart, ChartShape> = {
  kpi: { dims: { min: 0, max: 0 }, metrics: { min: 1, max: 1 } },
  bar: {
    dims: { min: 1, max: 2 },
    metrics: { min: 1, max: 1 },
    stackable: true,
  },
  column: {
    dims: { min: 1, max: 2 },
    metrics: { min: 1, max: 1 },
    stackable: true,
  },
  line: { dims: { min: 1, max: 2 }, metrics: { min: 1, max: 1 } },
  area: {
    dims: { min: 1, max: 2 },
    metrics: { min: 1, max: 1 },
    stackable: true,
  },
  donut: { dims: { min: 1, max: 1 }, metrics: { min: 1, max: 1 } },
  table: { dims: { min: 0, max: 2 }, metrics: { min: 1, max: 5 } },
  pivot: { dims: { min: 2, max: 2 }, metrics: { min: 1, max: 1 } },
  heatmap: { dims: { min: 2, max: 2 }, metrics: { min: 1, max: 1 } },
  scatter: { dims: { min: 0, max: 0 }, metrics: { min: 0, max: 0 }, xy: true },
  histogram: {
    dims: { min: 1, max: 1 },
    metrics: { min: 1, max: 1 },
    numericDim: true,
  },
};

// ---------------------------------------------------------------------------
// Field typing: which columns fit where
// ---------------------------------------------------------------------------

export type FieldType =
  | "category" // single choice
  | "multi" // checkboxes (one response, several values)
  | "number" // number, rating, linear scale
  | "date" // date question
  | "time" // submission time
  | "text" // short / long text
  | "meta"; // device, language, version

/** Questions that can never be chart columns (personal data). */
export const EXCLUDED_TYPES: readonly QuestionType[] = ["email", "phone"];

export function questionFieldType(type: QuestionType): FieldType | null {
  switch (type) {
    case "multiple_choice":
    case "dropdown":
      return "category";
    case "checkboxes":
      return "multi";
    case "number":
    case "rating":
    case "linear_scale":
      return "number";
    case "date":
      return "date";
    case "short_text":
    case "paragraph":
      return "text";
    default:
      return null;
  }
}

export function metaFieldType(field: MetaField): FieldType {
  if (field === "submitted_at") return "time";
  if (field === "duration") return "number";
  return "meta";
}

export function fieldType(
  ref: FieldRef,
  questions: Record<string, Question>,
): FieldType | null {
  if (ref.kind === "meta") return metaFieldType(ref.field);
  const q = questions[ref.key];
  return q ? questionFieldType(q.type) : null;
}

export function isNumericField(
  ref: FieldRef | undefined,
  questions: Record<string, Question>,
): boolean {
  return Boolean(ref && fieldType(ref, questions) === "number");
}

export function sameField(a: FieldRef, b: FieldRef): boolean {
  return a.kind === "question" && b.kind === "question"
    ? a.key === b.key
    : a.kind === "meta" && b.kind === "meta" && a.field === b.field;
}

export function fieldId(ref: FieldRef): string {
  return ref.kind === "question" ? `q:${ref.key}` : `m:${ref.field}`;
}

/** Aggregations that need a numeric field. */
export const NUMERIC_AGGS: readonly Aggregation[] = [
  "avg",
  "median",
  "min",
  "max",
  "sum",
  "nps",
  "csat",
];

export function needsField(agg: Aggregation): boolean {
  return NUMERIC_AGGS.includes(agg);
}

/** Grains offered for a dimension field. */
export function grainsFor(type: FieldType | null): TimeGrain[] {
  if (type === "time") return [...TIME_GRAINS];
  if (type === "date") return ["day", "week", "month", "weekday"];
  return [];
}

/** Sensible default grain for time / date dimensions. */
export function defaultGrain(type: FieldType | null): TimeGrain | undefined {
  if (type === "time") return "day";
  if (type === "date") return "day";
  return undefined;
}

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------

export function emptySpec(chart: CustomChart = "bar"): ChartSpec {
  return {
    chart,
    dimensions: [],
    metrics: [{ agg: "count" }],
    filters: [],
    sort: { by: "metric", dir: "desc" },
    limit: 20,
    options: { showValues: true, showLegend: true },
  };
}

export type SpecProblem =
  | "needsDimension"
  | "tooManyDimensions"
  | "needsMetric"
  | "tooManyMetrics"
  | "metricNeedsNumber"
  | "needsXY"
  | "numericDimension"
  | "unknownField";

/** What is missing before the chart can run (empty = ready). */
export function specProblems(
  spec: ChartSpec,
  questions: Record<string, Question>,
): SpecProblem[] {
  const shape = CHART_SHAPES[spec.chart];
  const problems: SpecProblem[] = [];
  const known = (ref: FieldRef) => fieldType(ref, questions) !== null;

  if (shape.xy) {
    if (
      !spec.x ||
      !spec.y ||
      !isNumericField(spec.x, questions) ||
      !isNumericField(spec.y, questions)
    )
      problems.push("needsXY");
    return problems;
  }
  if (spec.dimensions.length < shape.dims.min) problems.push("needsDimension");
  if (spec.dimensions.length > shape.dims.max)
    problems.push("tooManyDimensions");
  if (spec.metrics.length < shape.metrics.min) problems.push("needsMetric");
  if (spec.metrics.length > shape.metrics.max) problems.push("tooManyMetrics");
  if (
    spec.metrics.some(
      (m) => needsField(m.agg) && !isNumericField(m.field, questions),
    )
  )
    problems.push("metricNeedsNumber");
  if (
    shape.numericDim &&
    spec.dimensions[0] &&
    !isNumericField(spec.dimensions[0].field, questions)
  )
    problems.push("numericDimension");
  const refs = [
    ...spec.dimensions.map((d) => d.field),
    ...spec.metrics.flatMap((m) => (m.field ? [m.field] : [])),
    ...spec.filters.map((f) => f.field),
  ];
  if (refs.some((r) => !known(r))) problems.push("unknownField");
  return problems;
}

/**
 * Switching chart type keeps whatever still fits (fields, filters, options)
 * and trims the rest, so people can try charts without losing work.
 */
export function changeChart(
  spec: ChartSpec,
  chart: CustomChart,
  questions: Record<string, Question>,
): ChartSpec {
  const shape = CHART_SHAPES[chart];
  const next: ChartSpec = { ...spec, chart };
  if (shape.xy) {
    const numeric = [
      ...spec.dimensions.map((d) => d.field),
      ...spec.metrics.flatMap((m) => (m.field ? [m.field] : [])),
    ].filter((f) => isNumericField(f, questions));
    next.x = spec.x ?? numeric[0];
    next.y = spec.y ?? numeric.find((f) => !next.x || !sameField(f, next.x));
    return next;
  }
  next.dimensions = spec.dimensions.slice(0, shape.dims.max);
  if (shape.numericDim) {
    const numericDim =
      next.dimensions.find((d) => isNumericField(d.field, questions)) ??
      (spec.x ? { field: spec.x } : undefined);
    next.dimensions = numericDim
      ? [{ ...numericDim, bins: numericDim.bins ?? 10 }]
      : [];
    next.metrics = [{ agg: "count" }];
    next.sort = { by: "dimension", dir: "asc" };
  }
  const metrics: Metric[] = next.metrics.length
    ? next.metrics
    : [{ agg: "count" }];
  next.metrics = metrics.slice(0, Math.max(shape.metrics.max, 1));
  if (!shape.stackable) next.options = { ...next.options, stacked: undefined };
  if (chart === "line" || chart === "area")
    next.sort = { by: "dimension", dir: "asc" };
  return next;
}

/** Spec for an existing auto question widget ("Open in builder"). */
export function specFromQuestion(question: Question): ChartSpec | null {
  const type = questionFieldType(question.type);
  if (!type) return null;
  const field: FieldRef = { kind: "question", key: question.key };
  const spec = emptySpec(
    type === "number" ? "column" : type === "date" ? "line" : "bar",
  );
  if (type === "text")
    return { ...spec, chart: "table", dimensions: [{ field }], limit: 15 };
  if (type === "date")
    return {
      ...spec,
      dimensions: [{ field, grain: "day" }],
      sort: { by: "dimension", dir: "asc" },
    };
  if (question.type === "number")
    return {
      ...spec,
      chart: "histogram",
      dimensions: [{ field, bins: 10 }],
      sort: { by: "dimension", dir: "asc" },
    };
  if (type === "number")
    return {
      ...spec,
      dimensions: [{ field }],
      sort: { by: "dimension", dir: "asc" },
    };
  return { ...spec, dimensions: [{ field }] };
}

// ---------------------------------------------------------------------------
// Builder placement: where a column can go and what dropping it does
// ---------------------------------------------------------------------------

export type DropTarget = SlotId | "filters";

/** Slots shown for a chart, in display order. */
export function slotsFor(chart: CustomChart): SlotId[] {
  const shape = CHART_SHAPES[chart];
  if (shape.xy) return ["x", "y"];
  const slots: SlotId[] = [];
  if (shape.dims.max >= 1) slots.push("dim0");
  if (shape.dims.max >= 2) slots.push("dim1");
  if (shape.metrics.max >= 1) slots.push("metrics");
  return slots;
}

export function slotAccepts(
  target: DropTarget,
  chart: CustomChart,
  type: FieldType | null,
): boolean {
  if (type === null) return false;
  if (target === "filters") return true;
  if (!slotsFor(chart).includes(target)) return false;
  if (target === "metrics" || target === "x" || target === "y")
    return type === "number";
  if (target === "dim0" && CHART_SHAPES[chart].numericDim)
    return type === "number";
  return true;
}

/** Free numbers and durations default to ranges; ratings / scales stay exact. */
function wantsBins(
  ref: FieldRef,
  questions: Record<string, Question>,
): boolean {
  if (ref.kind === "meta") return ref.field === "duration";
  return questions[ref.key]?.type === "number";
}

export function newDimension(
  ref: FieldRef,
  chart: CustomChart,
  questions: Record<string, Question>,
): Dimension {
  const type = fieldType(ref, questions);
  const dim: Dimension = { field: ref };
  const grain = defaultGrain(type);
  if (grain) dim.grain = grain;
  if (
    type === "number" &&
    (CHART_SHAPES[chart].numericDim || wantsBins(ref, questions))
  )
    dim.bins = 10;
  return dim;
}

export function newFilter(
  ref: FieldRef,
  questions: Record<string, Question>,
): ChartFilter {
  const type = fieldType(ref, questions);
  if (type === "text") return { field: ref, op: "is_answered" };
  if (type === "number" || type === "date" || type === "time")
    return { field: ref, op: "gt", values: [] };
  return { field: ref, op: "in", values: [] };
}

/** Time / ordered dimensions read best sorted by the dimension itself. */
function ordered(dim: Dimension, questions: Record<string, Question>): boolean {
  const type = fieldType(dim.field, questions);
  return (
    type === "time" ||
    type === "date" ||
    Boolean(dim.bins) ||
    (type === "number" && dim.field.kind === "question")
  );
}

/**
 * Puts a column into a slot (drag & drop or the "+" picker). Returns null
 * when the column does not fit there.
 */
export function placeField(
  spec: ChartSpec,
  target: DropTarget,
  ref: FieldRef,
  questions: Record<string, Question>,
): ChartSpec | null {
  const type = fieldType(ref, questions);
  if (!slotAccepts(target, spec.chart, type)) return null;
  const shape = CHART_SHAPES[spec.chart];
  switch (target) {
    case "filters":
      if (spec.filters.length >= 10) return null;
      return { ...spec, filters: [...spec.filters, newFilter(ref, questions)] };
    case "x":
    case "y":
      return { ...spec, [target]: ref };
    case "metrics": {
      const metric: Metric = { agg: "avg", field: ref };
      const onlyCount = spec.metrics.length === 1 && !spec.metrics[0].field;
      const metrics =
        onlyCount && shape.metrics.max === 1
          ? [metric]
          : spec.metrics.length < shape.metrics.max
            ? [...spec.metrics, metric]
            : [...spec.metrics.slice(0, shape.metrics.max - 1), metric];
      return { ...spec, metrics };
    }
    case "dim0":
    case "dim1": {
      const dim = newDimension(ref, spec.chart, questions);
      const dims = [...spec.dimensions];
      const index = target === "dim1" && dims.length >= 1 ? 1 : 0;
      dims[index] = dim;
      const next: ChartSpec = { ...spec, dimensions: dims };
      if (index === 0 && spec.chart !== "table")
        next.sort = ordered(dim, questions)
          ? { by: "dimension", dir: "asc" }
          : { by: "metric", dir: "desc" };
      // A time axis shows the whole period, not just its first 20 points.
      if (index === 0 && (type === "time" || type === "date"))
        next.limit = Math.max(spec.limit, 500);
      return next;
    }
  }
}

/** Filters still waiting for a value are left out of the query. */
export function filterReady(filter: ChartFilter): boolean {
  if (filter.op === "is_answered" || filter.op === "is_empty") return true;
  return Boolean(filter.values?.some((v) => String(v).trim() !== ""));
}

export function cleanSpec(spec: ChartSpec): ChartSpec {
  return { ...spec, filters: spec.filters.filter(filterReady) };
}

/**
 * Click-to-add: the first empty slot that fits. Numbers measure (go to the
 * metric) once there is something to group by; other columns group.
 */
export function autoPlace(
  spec: ChartSpec,
  ref: FieldRef,
  questions: Record<string, Question>,
): { spec: ChartSpec; target: DropTarget } | null {
  const type = fieldType(ref, questions);
  const slots = slotsFor(spec.chart);
  const defaultMetric =
    spec.metrics.length === 0 ||
    (spec.metrics.length === 1 && !spec.metrics[0].field);
  const empty = (slot: SlotId) =>
    slot === "dim0"
      ? spec.dimensions.length === 0
      : slot === "dim1"
        ? spec.dimensions.length === 1
        : slot === "metrics"
          ? defaultMetric
          : !spec[slot];
  const order: SlotId[] =
    type === "number" && spec.dimensions.length > 0
      ? ["metrics", "dim1", "x", "y"]
      : ["dim0", "dim1", "x", "y", "metrics"];
  for (const slot of order) {
    if (!slots.includes(slot) || !empty(slot)) continue;
    const next = placeField(spec, slot, ref, questions);
    if (next) return { spec: next, target: slot };
  }
  return null;
}
