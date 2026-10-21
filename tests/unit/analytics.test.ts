import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import {
  allowedCharts,
  buildAutoDashboard,
  defaultChart,
  hasWidget,
} from "@/lib/analytics/auto";
import {
  dashboardConfigSchema,
  type DashboardConfig,
} from "@/lib/analytics/config";
import {
  EMPTY_FILTERS,
  dateWindow,
  isWithinDateWindow,
  parseFilters,
  serializeFilters,
  toRpcFilters,
  toggleAnswerFilter,
} from "@/lib/analytics/filters";
import {
  overviewInsight,
  questionInsight,
  type InsightFormat,
} from "@/lib/analytics/insights";
import { mergeDashboardConfig } from "@/lib/analytics/merge";
import {
  csat,
  distributionMean,
  median,
  nps,
  quantile,
  stddev,
  sturges,
  trendPercent,
} from "@/lib/analytics/stats";
import type { Overview, QuestionStats } from "@/lib/analytics/types";
import {
  QUESTION_TYPES,
  type FormDefinition,
  type Question,
} from "@/lib/forms/schema";
import { getTemplate } from "@/lib/forms/templates";
import { form, question, yesNo } from "./forms/fixtures";

describe("stats helpers", () => {
  it("quantiles match percentile_cont", () => {
    const v = [1, 2, 3, 4, 10];
    expect(median(v)).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile(v, 0.25)).toBe(2);
    expect(quantile(v, 0.75)).toBe(4);
    expect(quantile([10, 20], 0.9)).toBe(19);
    expect(median([])).toBeNull();
  });

  it("NPS and CSAT from distributions", () => {
    // 3 promoters (9,10,10), 2 passives (7,8), 5 detractors -> (3-5)/10 = -20
    const dist = [0, 3, 5, 6, 6, 7, 8, 9, 10, 10].reduce<
      { value: number; count: number }[]
    >((acc, v) => {
      const found = acc.find((d) => d.value === v);
      if (found) found.count++;
      else acc.push({ value: v, count: 1 });
      return acc;
    }, []);
    expect(nps(dist)).toBe(-20);
    expect(
      csat([
        { value: 5, count: 2 },
        { value: 4, count: 1 },
        { value: 1, count: 1 },
      ]),
    ).toBe(75);
    expect(nps([])).toBeNull();
    expect(
      distributionMean([
        { value: 1, count: 1 },
        { value: 5, count: 3 },
      ]),
    ).toBe(4);
  });

  it("trends, stddev and Sturges", () => {
    expect(trendPercent(12, 10)).toBe(20);
    expect(trendPercent(5, 0)).toBeNull();
    expect(trendPercent(0, 0)).toBe(0);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sturges(300)).toBe(10);
    expect(sturges(1)).toBe(1);
  });
});

describe("buildAutoDashboard", () => {
  it("maps every question type to its default chart", () => {
    const expected: Record<string, string | null> = {
      short_text: "terms",
      paragraph: "terms",
      checkboxes: "bar",
      number: "histogram",
      date: "area",
      rating: "column",
      linear_scale: "column",
      email: null,
      phone: null,
      // Expanded into analysis questions (rows, positions) or not charted.
      grid: null,
      ranking: null,
      location: null,
      photo: null,
    };
    for (const type of QUESTION_TYPES) {
      const q = question({ key: "k", type, options: yesNo });
      if (type === "multiple_choice" || type === "dropdown") {
        expect(defaultChart(q)).toBe("donut");
        expect(
          defaultChart({
            ...q,
            options: Array.from({ length: 6 }, (_, i) => ({
              id: `o${i}`,
              label: `${i}`,
            })),
          }),
        ).toBe("bar");
      } else {
        expect(defaultChart(q)).toBe(expected[type]);
      }
      expect(hasWidget(type)).toBe(
        expected[type] !== null ||
          type === "multiple_choice" ||
          type === "dropdown",
      );
      if (hasWidget(type))
        expect(allowedCharts(type)).toContain(defaultChart(q));
    }
  });

  it("creates overview, a heading per section and one widget per eligible question", () => {
    const definition = getTemplate("customer_satisfaction", "en").definition;
    const config = buildAutoDashboard(definition);
    expect(dashboardConfigSchema.safeParse(config).success).toBe(true);
    const kinds = config.widgets.map((w) => w.kind);
    expect(kinds.slice(0, 6)).toEqual([
      "overview_kpis",
      "overview_timeline",
      "overview_heatmap",
      "overview_devices",
      "overview_locales",
      "suggestions",
    ]);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(2);
    const eligible = definition.sections
      .flatMap((s) => s.questions)
      .filter((q) => hasWidget(q.type));
    expect(
      config.widgets
        .filter((w) => w.kind === "question")
        .map((w) => w.questionKey),
    ).toEqual(eligible.map((q) => q.key));
    // No overlapping widgets on the 12-column grid.
    const cells = new Set<string>();
    for (const w of config.widgets) {
      expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
      for (let x = w.layout.x; x < w.layout.x + w.layout.w; x++)
        for (let y = w.layout.y; y < w.layout.y + w.layout.h; y++) {
          expect(cells.has(`${x}:${y}`)).toBe(false);
          cells.add(`${x}:${y}`);
        }
    }
  });
});

describe("mergeDashboardConfig", () => {
  const v1: FormDefinition = form(
    question({ key: "a", type: "rating", rating: { max: 5 } }),
    question({ key: "b", type: "multiple_choice", options: yesNo }),
    question({ key: "c", type: "number" }),
  );

  function customized(): DashboardConfig {
    const config = buildAutoDashboard(v1);
    return {
      ...config,
      title: "My dashboard",
      widgets: config.widgets.map((w) => {
        if (w.questionKey === "a")
          return {
            ...w,
            title: "Renamed",
            note: "Context",
            chart: "donut",
            layout: { ...w.layout, w: 12, h: 14 },
          };
        if (w.questionKey === "b") return { ...w, hidden: true };
        return w;
      }),
    };
  }

  it("returns the auto dashboard when nothing is saved", () => {
    expect(mergeDashboardConfig(null, v1)).toEqual(buildAutoDashboard(v1));
  });

  it("adds new questions in a 'New' group without touching user changes", () => {
    const saved = customized();
    const v2 = form(
      ...v1.sections[0].questions,
      question({ key: "d", type: "checkboxes", options: yesNo }),
    );
    const merged = mergeDashboardConfig(saved, v2);

    for (const w of saved.widgets) expect(merged.widgets).toContainEqual(w);
    const added = merged.widgets.slice(saved.widgets.length);
    expect(added.map((w) => w.kind)).toEqual(["heading", "question"]);
    expect(added[0].newGroup).toBe(true);
    expect(added[1].questionKey).toBe("d");
    const savedBottom = Math.max(
      ...saved.widgets.map((w) => w.layout.y + w.layout.h),
    );
    expect(added[0].layout.y).toBeGreaterThanOrEqual(savedBottom);
    expect(merged.knownKeys).toContain("d");
    expect(merged.title).toBe("My dashboard");
  });

  it("keeps widgets of removed questions and is idempotent", () => {
    const saved = customized();
    const v2 = form(v1.sections[0].questions[0], v1.sections[0].questions[1]); // "c" removed
    const merged = mergeDashboardConfig(saved, v2);
    expect(merged.widgets).toEqual(saved.widgets);
    expect(merged.widgets.some((w) => w.questionKey === "c")).toBe(true);
    expect(mergeDashboardConfig(merged, v2)).toEqual(merged);
  });

  it("does not re-add a question the user removed or hid", () => {
    const saved = customized();
    saved.widgets = saved.widgets.filter((w) => w.questionKey !== "c");
    expect(
      mergeDashboardConfig(saved, v1).widgets.some(
        (w) => w.questionKey === "c",
      ),
    ).toBe(false);
  });
});

describe("filters", () => {
  const NOW = Date.parse("2026-10-12T15:30:00Z"); // 22:30 WIB, Monday

  it("round-trips through the URL", () => {
    const filters = {
      ...EMPTY_FILTERS,
      range: "custom" as const,
      from: "2026-10-01",
      to: "2026-10-10",
      versionIds: ["6f9619ff-8b86-4011-b42d-00c04fc964ff"],
      answers: [{ questionKey: "abc", values: ["yes", "a|b:c", "4"] }],
      device: "mobile",
      locale: "id",
      compare: true,
    };
    const params = serializeFilters(filters);
    expect(parseFilters(new URLSearchParams(params.toString()))).toEqual(
      filters,
    );
  });

  it("ignores invalid params", () => {
    expect(
      parseFilters({
        range: "forever",
        v: "nope",
        a: ["bad key:x", "k:"],
        device: "<script>",
      }),
    ).toEqual(EMPTY_FILTERS);
  });

  it("computes Jakarta day windows for presets", () => {
    expect(dateWindow({ ...EMPTY_FILTERS, range: "today" }, NOW)).toEqual({
      from: "2026-10-11T17:00:00.000Z",
      to: "2026-10-12T17:00:00.000Z",
    });
    expect(dateWindow({ ...EMPTY_FILTERS, range: "7d" }, NOW)?.from).toBe(
      "2026-10-05T17:00:00.000Z",
    );
    expect(
      dateWindow(
        {
          ...EMPTY_FILTERS,
          range: "custom",
          from: "2026-10-01",
          to: "2026-10-01",
        },
        NOW,
      ),
    ).toEqual({
      from: "2026-09-30T17:00:00.000Z",
      to: "2026-10-01T17:00:00.000Z",
    });
    expect(dateWindow(EMPTY_FILTERS, NOW)).toBeNull();
  });

  it("builds the RPC argument and toggles drill-down values", () => {
    let f = toggleAnswerFilter(EMPTY_FILTERS, "q1", "yes");
    f = toggleAnswerFilter(f, "q1", "no");
    expect(toRpcFilters({ ...f, device: "mobile" }, NOW)).toEqual({
      answers: [
        { questionKey: "q1", operator: "any_of", values: ["yes", "no"] },
      ],
      device: "mobile",
    });
    f = toggleAnswerFilter(toggleAnswerFilter(f, "q1", "yes"), "q1", "no");
    expect(f.answers).toEqual([]);
  });

  it("knows whether a new response can match the date window", () => {
    const f = {
      ...EMPTY_FILTERS,
      range: "custom" as const,
      from: "2026-10-01",
      to: "2026-10-02",
    };
    expect(isWithinDateWindow(f, "2026-10-12T15:00:00Z", NOW)).toBe(false);
    expect(
      isWithinDateWindow(
        { ...EMPTY_FILTERS, range: "today" },
        "2026-10-12T15:00:00Z",
        NOW,
      ),
    ).toBe(true);
  });
});

describe("insights (en and id)", () => {
  const translators = {
    en: createTranslator({ locale: "en", messages: en }),
    id: createTranslator({ locale: "id", messages: id }),
  };
  const fmtFor = (locale: "en" | "id"): InsightFormat => ({
    number: (v, d = 0) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(v),
    percent: (r) =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(r),
    option: (_k, o) => ({ yes: "Yes", no: "No" })[o] ?? o,
    weekday: (d) => translators[locale](`weekdays.${d}` as never),
    questionTitle: () => "Q",
  });
  const render = (
    locale: "en" | "id",
    insight: ReturnType<typeof questionInsight>,
  ) =>
    translators[locale](
      `insights.${insight!.key}` as never,
      insight!.values as never,
    );

  const base = { key: "q", n: 40, total: 50, eligible: 50, low_sample: false };
  const cases: [Question, QuestionStats, string, string][] = [
    [
      question({ key: "q", type: "multiple_choice", options: yesNo }),
      {
        ...base,
        type: "multiple_choice",
        options: [
          { id: "yes", count: 30 },
          { id: "no", count: 10 },
        ],
        other: 0,
      },
      "Most common answer: Yes (75% of answers).",
      "Jawaban terbanyak: Yes (75% jawaban).",
    ],
    [
      question({ key: "q", type: "rating", rating: { max: 5 } }),
      {
        ...base,
        type: "rating",
        min: 1,
        max: 5,
        mean: 4.25,
        median: 4,
        stddev: 1,
        distribution: [],
        nps: null,
        promoters: null,
        passives: null,
        detractors: null,
        csat: 80,
      },
      "Average rating 4.3 of 5; 80% gave 4 or 5.",
      "Rata-rata penilaian 4,3 dari 5; 80% memberi 4 atau 5.",
    ],
    [
      question({ key: "q", type: "linear_scale", scale: { min: 0, max: 10 } }),
      {
        ...base,
        type: "linear_scale",
        min: 0,
        max: 10,
        mean: 7,
        median: 7,
        stddev: 2,
        distribution: [],
        nps: 25,
        promoters: 20,
        passives: 10,
        detractors: 10,
        csat: null,
      },
      "NPS is 25: 50% promoters and 25% detractors.",
      "NPS sebesar 25: 50% promotor dan 25% detraktor.",
    ],
    [
      question({ key: "q", type: "number" }),
      {
        ...base,
        type: "number",
        min: 0,
        max: 60,
        mean: 20,
        median: 18,
        p25: 11,
        p75: 25,
        p90: 30,
        stddev: 9,
        histogram: [],
      },
      "Median 18; the middle half of answers lies between 11 and 25.",
      "Median 18; separuh jawaban di tengah berada antara 11 dan 25.",
    ],
    [
      question({ key: "q", type: "date" }),
      {
        ...base,
        type: "date",
        granularity: "day",
        min: null,
        max: null,
        series: [],
        weekdays: [
          { dow: 1, count: 4 },
          { dow: 5, count: 20 },
        ],
      },
      "Most dates fall on a Friday (50%).",
      "Tanggal paling banyak jatuh pada hari Jumat (50%).",
    ],
    [
      question({ key: "q", type: "paragraph" }),
      {
        ...base,
        type: "paragraph",
        avg_length: 42,
        terms: [{ term: "queue", count: 12 }],
      },
      "Most mentioned word: “queue” (in 12 answers).",
      "Kata paling sering: “queue” (di 12 jawaban).",
    ],
  ];

  it.each(cases)(
    "%#: renders a sentence with real numbers",
    (q, stats, expectedEn, expectedId) => {
      expect(render("en", questionInsight(q, stats, fmtFor("en")))).toBe(
        expectedEn,
      );
      expect(render("id", questionInsight(q, stats, fmtFor("id")))).toBe(
        expectedId,
      );
    },
  );

  it("handles no data and the overview trend", () => {
    expect(
      questionInsight(cases[0][0], { ...cases[0][1], n: 0 }, fmtFor("en"))?.key,
    ).toBe("noData");
    const overview = {
      total: 300,
      last7: 120,
      prev7: 100,
      heatmap: [],
    } as unknown as Overview;
    const insight = overviewInsight(overview, fmtFor("en"));
    expect(
      translators.en(
        `insights.${insight.key}` as never,
        insight.values as never,
      ),
    ).toBe(
      "300 responses in total; the last 7 days are up 20% on the 7 days before.",
    );
  });
});
