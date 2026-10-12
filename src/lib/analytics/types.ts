/** JSON shapes returned by the dashboard RPCs (see supabase/migrations/*phase4*). */
import type { QuestionType } from "@/lib/forms/schema";

export type CountBucket = { t: string; count: number };
export type KeyCount = { key: string; count: number };

export type Overview = {
  n: number;
  low_sample: boolean;
  total: number;
  today: number;
  last7: number;
  prev7: number;
  previous_period: number | null;
  first_at: string | null;
  last_at: string | null;
  timeline: { granularity: "hour" | "day" | "week"; buckets: CountBucket[] };
  heatmap: { dow: number; hour: number; count: number }[];
  duration: { n: number; mean: number | null; median: number | null } | null;
  devices: KeyCount[];
  locales: KeyCount[];
  versions: {
    id: string;
    number: number;
    published_at: string;
    count: number;
  }[];
  funnel: { submitted: number; abandoned: number; started: number };
};

type Base = {
  key: string;
  n: number;
  /** Responses matching the filters. */
  total: number;
  /** Responses whose version contains this question. */
  eligible: number;
  low_sample: boolean;
  version_numbers?: number[];
  in_current?: boolean;
};

export type ChoiceStats = Base & {
  type: "multiple_choice" | "dropdown";
  options: { id: string; count: number }[];
  other: number;
};
export type CheckboxStats = Base & {
  type: "checkboxes";
  options: { id: string; count: number; percent: number }[];
  avg_selections: number | null;
  pairs: { a: string; b: string; count: number }[];
};
export type ScaleStats = Base & {
  type: "rating" | "linear_scale";
  min: number;
  max: number;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  distribution: { value: number; count: number }[];
  nps: number | null;
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
  csat: number | null;
};
export type NumberStats = Base & {
  type: "number";
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  stddev: number | null;
  histogram: { from: number; to: number; count: number }[];
};
export type DateStats = Base & {
  type: "date";
  granularity: "day" | "week" | "month" | null;
  min: string | null;
  max: string | null;
  series: CountBucket[];
  weekdays: { dow: number; count: number }[];
};
export type TextStats = Base & {
  type: "short_text" | "paragraph";
  avg_length: number | null;
  terms: { term: string; count: number }[];
};
export type ContactStats = Base & { type: "email" | "phone" };

export type QuestionStats =
  | ChoiceStats
  | CheckboxStats
  | ScaleStats
  | NumberStats
  | DateStats
  | TextStats
  | ContactStats;

export type DashboardBundle = {
  generated_at: string;
  form: {
    title: string;
    description: string | null;
    created_at: string;
    creator: string;
  };
  overview: Overview;
  questions: Record<string, QuestionStats>;
};

export type CrossStats =
  | {
      kind: "cat_cat";
      a: string;
      b: string;
      n: number;
      low_sample: boolean;
      cells: { a: string; b: string; count: number }[];
      chi2: number | null;
      cramers_v: number | null;
    }
  | {
      kind: "cat_num";
      a: string;
      b: string;
      n: number;
      low_sample: boolean;
      groups: {
        option: string;
        n: number;
        mean: number;
        stddev: number | null;
      }[];
      effect: number | null;
    }
  | {
      kind: "num_num";
      a: string;
      b: string;
      n: number;
      low_sample: boolean;
      r: number | null;
      points: { x: number; y: number }[] | null;
    }
  | {
      kind: "unsupported";
      a: string;
      b: string;
      n: number;
      low_sample: boolean;
    };

export type CrossSuggestion = {
  a: string;
  b: string;
  kind: "cat_cat" | "cat_num" | "num_num";
  metric: "cramers_v" | "effect" | "r";
  value: number;
  score: number;
  n: number;
};

/** Types that get widgets / are categorical / numeric in cross analysis. */
export const CATEGORICAL_TYPES: readonly QuestionType[] = [
  "multiple_choice",
  "dropdown",
  "checkboxes",
];
export const NUMERIC_TYPES: readonly QuestionType[] = [
  "rating",
  "linear_scale",
  "number",
];
export const LOW_SAMPLE = 30;
