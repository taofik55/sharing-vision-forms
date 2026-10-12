/**
 * Dashboard / responses filters. State lives in the URL so links are
 * shareable; toRpcFilters() converts to the jsonb argument of the RPCs.
 * Date presets are calendar days in Asia/Jakarta (UTC+7, no DST).
 */
export const DATE_PRESETS = ["all", "today", "7d", "30d"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number] | "custom";

export type AnswerFilter = { questionKey: string; values: string[] };

export type DashboardFilters = {
  range: DatePreset;
  /** YYYY-MM-DD (inclusive), only for range = custom. */
  from?: string;
  to?: string;
  versionIds: string[];
  answers: AnswerFilter[];
  device?: string;
  locale?: string;
  compare: boolean;
};

export type RpcFilters = {
  from?: string;
  to?: string;
  versionIds?: string[];
  answers?: { questionKey: string; operator: "any_of"; values: string[] }[];
  device?: string;
  locale?: string;
};

export const EMPTY_FILTERS: DashboardFilters = {
  range: "all",
  versionIds: [],
  answers: [],
  compare: false,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = /^[A-Za-z0-9_.-]{1,32}$/;
const OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

type ParamSource =
  URLSearchParams | Record<string, string | string[] | undefined>;

function getAll(source: ParamSource, key: string): string[] {
  if (source instanceof URLSearchParams) return source.getAll(key);
  const value = source[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Parses URL params; anything invalid is ignored. */
export function parseFilters(source: ParamSource): DashboardFilters {
  const first = (k: string) => getAll(source, k)[0];
  const filters: DashboardFilters = {
    ...EMPTY_FILTERS,
    versionIds: [],
    answers: [],
  };

  const range = first("range");
  const from = first("from");
  const to = first("to");
  if (from && DATE.test(from)) {
    filters.range = "custom";
    filters.from = from;
    if (to && DATE.test(to) && to >= from) filters.to = to;
  } else if (range && (DATE_PRESETS as readonly string[]).includes(range)) {
    filters.range = range as DatePreset;
  }

  filters.versionIds = (first("v") ?? "")
    .split(",")
    .filter((id) => UUID.test(id))
    .slice(0, 50);

  for (const raw of getAll(source, "a").slice(0, 20)) {
    const sep = raw.indexOf(":");
    if (sep <= 0) continue;
    const questionKey = raw.slice(0, sep);
    const values = raw
      .slice(sep + 1)
      .split("|")
      .map((v) => {
        try {
          return decodeURIComponent(v);
        } catch {
          return "";
        }
      })
      .filter((v) => v.length > 0 && v.length <= 200)
      .slice(0, 50);
    if (KEY.test(questionKey) && values.length)
      filters.answers.push({ questionKey, values });
  }

  const device = first("device");
  if (device && SHORT.test(device)) filters.device = device;
  const locale = first("lang");
  if (locale && SHORT.test(locale)) filters.locale = locale;
  filters.compare = first("compare") === "1";
  return filters;
}

/** Inverse of parseFilters (only non-default values are written). */
export function serializeFilters(filters: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.range === "custom" && filters.from) {
    params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  } else if (filters.range !== "all" && filters.range !== "custom") {
    params.set("range", filters.range);
  }
  if (filters.versionIds.length) params.set("v", filters.versionIds.join(","));
  for (const a of filters.answers) {
    params.append(
      "a",
      `${a.questionKey}:${a.values.map((v) => encodeURIComponent(v)).join("|")}`,
    );
  }
  if (filters.device) params.set("device", filters.device);
  if (filters.locale) params.set("lang", filters.locale);
  if (filters.compare) params.set("compare", "1");
  return params;
}

/** Start of the Jakarta calendar day containing `ms`, as a UTC epoch. */
function jakartaDayStart(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
}

function jakartaDateToUtc(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - OFFSET_MS;
}

/** Absolute [from, to) window for the date filter, or null for "all". */
export function dateWindow(
  filters: DashboardFilters,
  now = Date.now(),
): { from: string; to: string } | null {
  const todayStart = jakartaDayStart(now);
  const tomorrow = todayStart + DAY_MS;
  const iso = (ms: number) => new Date(ms).toISOString();
  switch (filters.range) {
    case "today":
      return { from: iso(todayStart), to: iso(tomorrow) };
    case "7d":
      return { from: iso(todayStart - 6 * DAY_MS), to: iso(tomorrow) };
    case "30d":
      return { from: iso(todayStart - 29 * DAY_MS), to: iso(tomorrow) };
    case "custom": {
      if (!filters.from) return null;
      const to = filters.to ? jakartaDateToUtc(filters.to) + DAY_MS : tomorrow;
      return { from: iso(jakartaDateToUtc(filters.from)), to: iso(to) };
    }
    default:
      return null;
  }
}

export function toRpcFilters(
  filters: DashboardFilters,
  now = Date.now(),
): RpcFilters {
  const rpc: RpcFilters = {};
  const window = dateWindow(filters, now);
  if (window) Object.assign(rpc, window);
  if (filters.versionIds.length) rpc.versionIds = filters.versionIds;
  if (filters.answers.length) {
    rpc.answers = filters.answers.map((a) => ({
      questionKey: a.questionKey,
      operator: "any_of",
      values: a.values,
    }));
  }
  if (filters.device) rpc.device = filters.device;
  if (filters.locale) rpc.locale = filters.locale;
  return rpc;
}

/** Adds a value to the answer filter of a question (drill-down), toggling it. */
export function toggleAnswerFilter(
  filters: DashboardFilters,
  questionKey: string,
  value: string,
): DashboardFilters {
  const existing = filters.answers.find((a) => a.questionKey === questionKey);
  let answers: AnswerFilter[];
  if (!existing)
    answers = [...filters.answers, { questionKey, values: [value] }];
  else {
    const values = existing.values.includes(value)
      ? existing.values.filter((v) => v !== value)
      : [...existing.values, value];
    answers = filters.answers
      .map((a) => (a.questionKey === questionKey ? { ...a, values } : a))
      .filter((a) => a.values.length > 0);
  }
  return { ...filters, answers };
}

export function hasActiveFilters(filters: DashboardFilters): boolean {
  return (
    filters.range !== "all" ||
    filters.versionIds.length > 0 ||
    filters.answers.length > 0 ||
    Boolean(filters.device || filters.locale)
  );
}

/** True if a response submitted at `at` can match the date window (for live updates). */
export function isWithinDateWindow(
  filters: DashboardFilters,
  at: string,
  now = Date.now(),
): boolean {
  const window = dateWindow(filters, now);
  if (!window) return true;
  const t = Date.parse(at);
  return t >= Date.parse(window.from) && t < Date.parse(window.to);
}

export const RESPONSE_SORTS = [
  "newest",
  "oldest",
  "duration_desc",
  "duration_asc",
] as const;
export type ResponseSort = (typeof RESPONSE_SORTS)[number];
