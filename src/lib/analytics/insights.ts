/**
 * "Key insight" sentences from real numbers. Pure: returns an i18n key in the
 * `insights` namespace plus pre-formatted values, so the same logic serves
 * every locale (see messages/*.json > insights).
 */
import type { Question } from "@/lib/forms/schema";
import { trendPercent } from "./stats";
import type { CrossStats, Overview, QuestionStats } from "./types";

export type InsightFormat = {
  number: (value: number, maxFractionDigits?: number) => string;
  /** Ratio 0..1 as a percentage. */
  percent: (ratio: number) => string;
  /** Option label of a question (falls back to the id). */
  option: (questionKey: string, optionId: string) => string;
  /** ISO weekday 1 (Mon) .. 7 (Sun). */
  weekday: (dow: number) => string;
  questionTitle: (questionKey: string) => string;
};

export type Insight = { key: string; values: Record<string, string> };

export function questionInsight(
  question: Question,
  stats: QuestionStats | undefined,
  fmt: InsightFormat,
): Insight | null {
  if (!stats) return null;
  if (stats.n === 0) return { key: "noData", values: {} };
  const n = stats.n;

  switch (stats.type) {
    case "multiple_choice":
    case "dropdown": {
      const top = stats.options[0];
      if (!top) return null;
      return {
        key: "choiceTop",
        values: {
          option: fmt.option(question.key, top.id),
          share: fmt.percent(top.count / n),
        },
      };
    }
    case "checkboxes": {
      const top = stats.options[0];
      if (!top) return null;
      return {
        key: "checkboxTop",
        values: {
          option: fmt.option(question.key, top.id),
          share: fmt.percent(top.count / n),
          avg: fmt.number(stats.avg_selections ?? 0, 1),
        },
      };
    }
    case "rating":
    case "linear_scale": {
      if (stats.nps !== null && stats.nps !== undefined) {
        return {
          key: "nps",
          values: {
            nps: fmt.number(stats.nps, 0),
            promoters: fmt.percent((stats.promoters ?? 0) / n),
            detractors: fmt.percent((stats.detractors ?? 0) / n),
          },
        };
      }
      if (stats.csat !== null && stats.csat !== undefined) {
        return {
          key: "ratingCsat",
          values: {
            mean: fmt.number(stats.mean ?? 0, 1),
            max: fmt.number(stats.max),
            share: fmt.percent(stats.csat / 100),
          },
        };
      }
      return {
        key: "scaleMean",
        values: {
          mean: fmt.number(stats.mean ?? 0, 1),
          min: fmt.number(stats.min),
          max: fmt.number(stats.max),
          median: fmt.number(stats.median ?? 0, 1),
        },
      };
    }
    case "number":
      return {
        key: "numberSpread",
        values: {
          median: fmt.number(stats.median ?? 0, 1),
          p25: fmt.number(stats.p25 ?? 0, 1),
          p75: fmt.number(stats.p75 ?? 0, 1),
        },
      };
    case "date": {
      const busiest = [...stats.weekdays].sort(
        (a, b) => b.count - a.count || a.dow - b.dow,
      )[0];
      if (!busiest || busiest.count === 0) return null;
      return {
        key: "dateWeekday",
        values: {
          weekday: fmt.weekday(busiest.dow),
          share: fmt.percent(busiest.count / n),
        },
      };
    }
    case "short_text":
    case "paragraph": {
      const term = stats.terms[0];
      if (term) {
        return {
          key: "textTerm",
          values: { term: term.term, count: fmt.number(term.count) },
        };
      }
      return {
        key: "textLength",
        values: {
          n: fmt.number(n),
          length: fmt.number(stats.avg_length ?? 0, 0),
        },
      };
    }
    default:
      return null;
  }
}

export function overviewInsight(
  overview: Overview,
  fmt: InsightFormat,
): Insight {
  if (overview.total === 0) return { key: "noData", values: {} };
  const trend = trendPercent(overview.last7, overview.prev7);
  if (trend === null) {
    return {
      key: "overviewNew",
      values: {
        total: fmt.number(overview.total),
        last7: fmt.number(overview.last7),
      },
    };
  }
  return {
    key:
      trend === 0 ? "overviewFlat" : trend > 0 ? "overviewUp" : "overviewDown",
    values: {
      total: fmt.number(overview.total),
      trend: fmt.percent(Math.abs(trend) / 100),
    },
  };
}

export function peakInsight(
  overview: Overview,
  fmt: InsightFormat,
): Insight | null {
  const peak = [...overview.heatmap].sort(
    (a, b) => b.count - a.count || a.dow - b.dow || a.hour - b.hour,
  )[0];
  if (!peak) return null;
  return {
    key: "peak",
    values: {
      weekday: fmt.weekday(peak.dow),
      hour: String(peak.hour).padStart(2, "0"),
    },
  };
}

export function splitInsight(
  rows: { key: string; count: number }[],
  label: (key: string) => string,
  fmt: InsightFormat,
): Insight | null {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const top = rows[0];
  if (!top || !total) return null;
  return {
    key: "split",
    values: { share: fmt.percent(top.count / total), value: label(top.key) },
  };
}

export function crossInsight(
  stats: CrossStats,
  fmt: InsightFormat,
): Insight | null {
  if (stats.n === 0) return { key: "noData", values: {} };
  switch (stats.kind) {
    case "cat_num": {
      const sorted = [...stats.groups].sort((a, b) => b.mean - a.mean);
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      if (!top || !bottom || top === bottom) return null;
      return {
        key: "crossGroups",
        values: {
          measure: fmt.questionTitle(stats.b),
          top: fmt.option(stats.a, top.option),
          topMean: fmt.number(top.mean, 1),
          bottom: fmt.option(stats.a, bottom.option),
          bottomMean: fmt.number(bottom.mean, 1),
        },
      };
    }
    case "cat_cat":
      if (stats.cramers_v === null) return null;
      return {
        key: "crossAssociation",
        values: {
          v: fmt.number(stats.cramers_v, 2),
          strength: strength(stats.cramers_v),
        },
      };
    case "num_num":
      if (stats.r === null)
        return { key: "crossFewPairs", values: { n: fmt.number(stats.n) } };
      return {
        key: stats.r >= 0 ? "crossPositive" : "crossNegative",
        values: {
          r: fmt.number(stats.r, 2),
          strength: strength(Math.abs(stats.r)),
        },
      };
    default:
      return null;
  }
}

/** Plain-language strength bucket (i18n key suffix under insights.strength). */
export function strength(value: number): "weak" | "moderate" | "strong" {
  const v = Math.abs(value);
  return v >= 0.5 ? "strong" : v >= 0.3 ? "moderate" : "weak";
}
