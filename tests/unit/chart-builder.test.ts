import { describe, expect, it } from "vitest";
import {
  binRange,
  buildChartModel,
  EMPTY_ID,
  formatValue,
  valueLabel,
  type ChartLabeler,
  type GroupedResult,
} from "@/lib/analytics/chart-result";
import {
  autoPlace,
  changeChart,
  chartSpecSchema,
  cleanSpec,
  emptySpec,
  placeField,
  slotAccepts,
  slotsFor,
  specFromQuestion,
  specProblems,
  type ChartSpec,
  type FieldRef,
} from "@/lib/analytics/chart-spec";
import { widgetSchema } from "@/lib/analytics/config";
import type { Question } from "@/lib/forms/schema";
import { question, yesNo } from "./forms/fixtures";

const questions: Record<string, Question> = {
  dept: question({
    key: "dept",
    type: "multiple_choice",
    options: [
      { id: "hr", label: "HR" },
      { id: "it", label: "IT" },
      { id: "ops", label: "Ops" },
    ],
  }),
  likes: question({ key: "likes", type: "checkboxes", options: yesNo }),
  age: question({ key: "age", type: "number" }),
  score: question({ key: "score", type: "rating" }),
  joined: question({ key: "joined", type: "date" }),
  comment: question({ key: "comment", type: "paragraph" }),
  mail: question({ key: "mail", type: "email" }),
};

const q = (key: string): FieldRef => ({ kind: "question", key });
const time: FieldRef = { kind: "meta", field: "submitted_at" };

const labeler: ChartLabeler = {
  question: (key) => questions[key]?.title ?? key,
  option: (key, id) =>
    questions[key]?.options?.find((o) => o.id === id)?.label ?? id,
  meta: (field) => field,
  device: (v) => `device:${v}`,
  locale: (v) => `locale:${v}`,
  weekday: (n) => `dow${n}`,
  period: (value, grain) => `${grain}:${value}`,
  agg: (agg) => agg,
  number: (value, digits) => String(Number(value.toFixed(digits))),
  empty: "(none)",
};

describe("chart spec placement", () => {
  it("slots follow the chart shape", () => {
    expect(slotsFor("bar")).toEqual(["dim0", "dim1", "metrics"]);
    expect(slotsFor("kpi")).toEqual(["metrics"]);
    expect(slotsFor("donut")).toEqual(["dim0", "metrics"]);
    expect(slotsFor("scatter")).toEqual(["x", "y"]);
  });

  it("only numbers measure; histograms need numbers; email never fits", () => {
    expect(slotAccepts("metrics", "bar", "number")).toBe(true);
    expect(slotAccepts("metrics", "bar", "category")).toBe(false);
    expect(slotAccepts("dim0", "histogram", "category")).toBe(false);
    expect(slotAccepts("dim0", "bar", "text")).toBe(true);
    expect(slotAccepts("dim1", "donut", "category")).toBe(false);
    expect(slotAccepts("filters", "kpi", "time")).toBe(true);
    expect(slotAccepts("filters", "kpi", null)).toBe(false);
  });

  it("dropping a time column picks a grain and sorts by time", () => {
    const spec = placeField(emptySpec("line"), "dim0", time, questions)!;
    expect(spec.dimensions).toEqual([{ field: time, grain: "day" }]);
    expect(spec.sort).toEqual({ by: "dimension", dir: "asc" });
    expect(spec.limit).toBe(500);
  });

  it("free numbers become ranges, ratings stay exact", () => {
    const age = placeField(emptySpec("bar"), "dim0", q("age"), questions)!;
    expect(age.dimensions[0].bins).toBe(10);
    const score = placeField(emptySpec("bar"), "dim0", q("score"), questions)!;
    expect(score.dimensions[0].bins).toBeUndefined();
    expect(score.sort.by).toBe("dimension");
  });

  it("a number replaces the default count metric with an average", () => {
    const spec = placeField(
      emptySpec("bar"),
      "metrics",
      q("score"),
      questions,
    )!;
    expect(spec.metrics).toEqual([{ agg: "avg", field: q("score") }]);
    const table = placeField(
      emptySpec("table"),
      "metrics",
      q("score"),
      questions,
    )!;
    expect(table.metrics).toHaveLength(2);
  });

  it("rejects columns that do not fit", () => {
    expect(
      placeField(emptySpec("bar"), "metrics", q("dept"), questions),
    ).toBeNull();
    expect(
      placeField(emptySpec("bar"), "dim0", q("mail"), questions),
    ).toBeNull();
  });

  it("click-to-add fills the next empty slot", () => {
    let spec = emptySpec("bar");
    spec = autoPlace(spec, q("dept"), questions)!.spec;
    expect(spec.dimensions[0].field).toEqual(q("dept"));
    const next = autoPlace(spec, q("score"), questions)!;
    expect(next.target).toBe("metrics");
    spec = autoPlace(next.spec, q("likes"), questions)!.spec;
    expect(spec.dimensions[1].field).toEqual(q("likes"));
    expect(autoPlace(spec, q("joined"), questions)).toBeNull();
    const scatter = autoPlace(emptySpec("scatter"), q("age"), questions)!;
    expect(scatter.target).toBe("x");
  });

  it("switching charts keeps what still fits", () => {
    let spec: ChartSpec = {
      ...emptySpec("bar"),
      dimensions: [{ field: q("dept") }, { field: q("likes") }],
      options: { stacked: true },
    };
    const donut = changeChart(spec, "donut", questions);
    expect(donut.dimensions).toHaveLength(1);
    expect(donut.options.stacked).toBeUndefined();
    spec = { ...emptySpec("bar"), dimensions: [{ field: q("age") }] };
    const hist = changeChart(spec, "histogram", questions);
    expect(hist.dimensions[0].bins).toBe(10);
    const scatter = changeChart(
      { ...spec, metrics: [{ agg: "avg", field: q("score") }] },
      "scatter",
      questions,
    );
    expect(scatter.x).toEqual(q("age"));
    expect(scatter.y).toEqual(q("score"));
  });

  it("reports what is missing", () => {
    expect(specProblems(emptySpec("bar"), questions)).toEqual([
      "needsDimension",
    ]);
    expect(specProblems(emptySpec("kpi"), questions)).toEqual([]);
    expect(
      specProblems(
        { ...emptySpec("kpi"), metrics: [{ agg: "avg" }] },
        questions,
      ),
    ).toContain("metricNeedsNumber");
    expect(specProblems(emptySpec("scatter"), questions)).toEqual(["needsXY"]);
    expect(
      specProblems(
        { ...emptySpec("bar"), dimensions: [{ field: q("gone") }] },
        questions,
      ),
    ).toContain("unknownField");
  });

  it("filters without values are left out", () => {
    const spec: ChartSpec = {
      ...emptySpec("kpi"),
      filters: [
        { field: q("dept"), op: "in", values: [] },
        { field: q("comment"), op: "is_answered" },
        { field: q("age"), op: "gt", values: [30] },
      ],
    };
    expect(cleanSpec(spec).filters.map((f) => f.op)).toEqual([
      "is_answered",
      "gt",
    ]);
  });

  it("specs from question widgets are valid", () => {
    for (const key of ["dept", "likes", "age", "score", "joined", "comment"]) {
      const spec = specFromQuestion(questions[key])!;
      expect(chartSpecSchema.safeParse(spec).success).toBe(true);
      expect(specProblems(spec, questions)).toEqual([]);
    }
    expect(specFromQuestion(questions.mail)).toBeNull();
  });

  it("custom widgets round-trip through the config schema", () => {
    const widget = {
      id: "custom:abc",
      kind: "custom",
      origin: "user",
      custom: { ...emptySpec("bar"), dimensions: [{ field: q("dept") }] },
      layout: { x: 0, y: 0, w: 6, h: 10 },
    };
    expect(widgetSchema.safeParse(widget).success).toBe(true);
    expect(
      widgetSchema.safeParse({
        ...widget,
        custom: { ...widget.custom, chart: "radar" },
      }).success,
    ).toBe(false);
  });
});

describe("chart results", () => {
  const grouped = (
    rows: GroupedResult["rows"],
    bins: GroupedResult["bins"] = {},
  ): GroupedResult => ({
    kind: "grouped",
    rows,
    total: 10,
    groups: rows.length,
    bins,
  });

  it("labels options, empties, time grains and bins", () => {
    const dim = { field: q("dept") };
    expect(valueLabel("it", dim, "category", undefined, labeler)).toBe("IT");
    expect(valueLabel(null, dim, "category", undefined, labeler)).toBe(
      "(none)",
    );
    expect(
      valueLabel(
        "3",
        { field: time, grain: "weekday" },
        "time",
        undefined,
        labeler,
      ),
    ).toBe("dow3");
    expect(
      valueLabel(
        "7",
        { field: time, grain: "hour_of_day" },
        "time",
        undefined,
        labeler,
      ),
    ).toBe("07:00");
    expect(
      valueLabel(
        "2026-10",
        { field: time, grain: "month" },
        "time",
        undefined,
        labeler,
      ),
    ).toBe("month:2026-10");
    const bin = { lo: 20, hi: 60, n: 4 };
    expect(binRange(2, bin)).toEqual({ from: 30, to: 40 });
    expect(
      valueLabel("2", { field: q("age"), bins: 4 }, "number", bin, labeler),
    ).toBe("30–40");
    expect(
      valueLabel(
        "tablet",
        { field: { kind: "meta", field: "device" } },
        "meta",
        undefined,
        labeler,
      ),
    ).toBe("device:tablet");
    expect(
      valueLabel(
        "2",
        { field: { kind: "meta", field: "version" } },
        "meta",
        undefined,
        labeler,
      ),
    ).toBe("v2");
  });

  it("formats values by aggregation", () => {
    expect(formatValue(12, { agg: "count" }, undefined, labeler)).toBe("12");
    expect(formatValue(33.33, { agg: "percent" }, undefined, labeler)).toBe(
      "33.3%",
    );
    expect(formatValue(4.256, { agg: "avg" }, undefined, labeler)).toBe("4.26");
    expect(formatValue(4.256, { agg: "avg" }, "integer", labeler)).toBe("4");
    expect(formatValue(null, { agg: "avg" }, undefined, labeler)).toBe("—");
  });

  it("single dimension → labelled items and table", () => {
    const spec: ChartSpec = {
      ...emptySpec("bar"),
      dimensions: [{ field: q("dept") }],
    };
    const model = buildChartModel(
      spec,
      grouped([
        ["it", 5],
        ["hr", 3],
        [null, 2],
      ]),
      questions,
      labeler,
    );
    expect(model.kind).toBe("single");
    if (model.kind !== "single") return;
    expect(model.items.map((i) => [i.id, i.label, i.value])).toEqual([
      ["it", "IT", 5],
      ["hr", "HR", 3],
      [EMPTY_ID, "(none)", 2],
    ]);
    expect(model.table.columns).toEqual(["dept", "count"]);
  });

  it("histograms show empty bins in order", () => {
    const spec: ChartSpec = {
      ...emptySpec("histogram"),
      dimensions: [{ field: q("age"), bins: 4 }],
      sort: { by: "dimension", dir: "asc" },
    };
    const model = buildChartModel(
      spec,
      grouped(
        [
          ["1", 2],
          ["4", 1],
        ],
        { "0": { lo: 20, hi: 60, n: 4 } },
      ),
      questions,
      labeler,
    );
    if (model.kind !== "single") throw new Error(model.kind);
    expect(model.items.map((i) => [i.label, i.value])).toEqual([
      ["20–30", 2],
      ["30–40", 0],
      ["40–50", 0],
      ["50–60", 1],
    ]);
  });

  it("two dimensions → series in option order; matrices for pivots", () => {
    const rows: GroupedResult["rows"] = [
      ["it", "no", 2],
      ["it", "yes", 3],
      ["hr", "yes", 1],
    ];
    const spec: ChartSpec = {
      ...emptySpec("column"),
      dimensions: [{ field: q("dept") }, { field: q("likes") }],
    };
    const multi = buildChartModel(spec, grouped(rows), questions, labeler);
    if (multi.kind !== "multi") throw new Error(multi.kind);
    expect(multi.categories.map((c) => c.label)).toEqual(["IT", "HR"]);
    expect(multi.series.map((s) => s.label)).toEqual(["Yes", "No"]);
    expect(multi.values).toEqual([
      [3, 2],
      [1, null],
    ]);
    const pivot = buildChartModel(
      { ...spec, chart: "pivot" },
      grouped(rows),
      questions,
      labeler,
    );
    if (pivot.kind !== "matrix") throw new Error(pivot.kind);
    expect(pivot.max).toBe(3);
    expect(pivot.table.rows).toHaveLength(3);
  });

  it("keeps the 8 largest series for colour slots", () => {
    const rows: GroupedResult["rows"] = Array.from({ length: 10 }, (_, i) => [
      "a",
      String(i),
      i + 1,
    ]);
    const spec: ChartSpec = {
      ...emptySpec("column"),
      dimensions: [{ field: q("dept") }, { field: q("comment") }],
    };
    const model = buildChartModel(spec, grouped(rows), questions, labeler);
    if (model.kind !== "multi") throw new Error(model.kind);
    expect(model.series).toHaveLength(8);
    expect(model.hiddenSeries).toBe(2);
    expect(model.series.map((s) => s.id)).not.toContain("0");
  });

  it("kpi, empty and scatter results", () => {
    const kpi = buildChartModel(
      { ...emptySpec("kpi"), metrics: [{ agg: "avg", field: q("score") }] },
      grouped([[4.5]]),
      questions,
      labeler,
    );
    expect(kpi).toMatchObject({ kind: "kpi", value: 4.5, display: "4.5" });
    const none = buildChartModel(
      { ...emptySpec("bar"), dimensions: [{ field: q("dept") }] },
      grouped([]),
      questions,
      labeler,
    );
    expect(none.kind).toBe("empty");
    const scatter = buildChartModel(
      { ...emptySpec("scatter"), x: q("age"), y: q("score") },
      {
        kind: "scatter",
        total: 3,
        n: 2,
        r: 0.5,
        points: [
          [20, 3],
          [30, 4],
        ],
      },
      questions,
      labeler,
    );
    expect(scatter).toMatchObject({
      kind: "scatter",
      n: 2,
      xLabel: "age",
      yLabel: "score",
    });
  });
});
