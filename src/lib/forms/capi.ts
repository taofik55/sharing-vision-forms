/**
 * CAPI (face-to-face interview) settings and pure helpers: quota cells,
 * respondent ID prefixes, QC flags and required surveyor notes. Stored in
 * forms.capi_settings (not versioned: quotas change during fieldwork).
 */
import { z } from "zod";
import { isChoiceAnswer, isGridAnswer, type Answers } from "./logic";
import { flattenQuestions, type FormDefinition } from "./schema";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const capiGroupSchema = z.object({
  /** Short code used in quota cells and respondent IDs (JKT, R, B). */
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,10}$/, { error: "groupCode" }),
  label: z.string().trim().max(100),
  optionIds: z.array(key).max(200),
});

export const capiDimensionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,20}$/),
  label: z.string().trim().min(1, { error: "dimensionLabel" }).max(100),
  questionKey: key,
  groups: z.array(capiGroupSchema).min(1).max(30),
});

export const capiSettingsSchema = z.object({
  /** Interviews by logged-in surveyors (the public link is disabled). */
  enabled: z.boolean().default(false),
  /** City x sector x segment: each answer maps to a group code. */
  dimensions: z.array(capiDimensionSchema).max(4).default([]),
  quota: z
    .object({
      enabled: z.boolean().default(false),
      /** Interviews per cell. */
      target: z.number().int().min(1).max(100_000).default(20),
      /** Extra interviews accepted per cell to replace QC rejects. */
      reserve: z.number().int().min(0).max(1000).default(0),
      /** Check the cell live right after this question (S10). */
      checkAfter: key.optional(),
    })
    .default({ enabled: false, target: 20, reserve: 0 }),
  respondentId: z
    .object({
      enabled: z.boolean().default(false),
      /** Sequence digits: SBY-F-N-07. */
      digits: z.number().int().min(1).max(6).default(2),
    })
    .default({ enabled: false, digits: 2 }),
  qc: z
    .object({
      minMinutes: z.number().min(0).max(600).default(12),
      maxMinutes: z.number().min(1).max(1440).default(45),
      backcheckPercent: z.number().int().min(1).max(100).default(20),
      /** Flag a question when "Other" exceeds this share of answers. */
      otherPercent: z.number().min(1).max(100).default(15),
    })
    .default({
      minMinutes: 12,
      maxMinutes: 45,
      backcheckPercent: 20,
      otherPercent: 15,
    }),
  /** A note field under every question for the interviewer. */
  notes: z.boolean().default(true),
});

export type CapiSettings = z.output<typeof capiSettingsSchema>;
export type CapiDimension = z.output<typeof capiDimensionSchema>;

export const DEFAULT_CAPI: CapiSettings = capiSettingsSchema.parse({});

export function parseCapiSettings(value: unknown): CapiSettings {
  const parsed = capiSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_CAPI;
}

/** Problems with settings against a definition (empty = valid). */
export function capiSettingsProblems(
  settings: CapiSettings,
  definition: FormDefinition | null,
): string[] {
  const problems: string[] = [];
  const byKey = new Map(
    (definition ? flattenQuestions(definition) : []).map((q) => [q.key, q]),
  );
  const ids = new Set<string>();
  for (const d of settings.dimensions) {
    if (ids.has(d.id)) problems.push("duplicateDimension");
    ids.add(d.id);
    const q = byKey.get(d.questionKey);
    if (!q || !["multiple_choice", "dropdown"].includes(q.type)) {
      problems.push("dimensionQuestion");
      continue;
    }
    const options = new Set((q.options ?? []).map((o) => o.id));
    const codes = new Set<string>();
    for (const g of d.groups) {
      if (codes.has(g.code)) problems.push("duplicateGroupCode");
      codes.add(g.code);
      if (g.optionIds.some((id) => !options.has(id)))
        problems.push("groupOption");
    }
  }
  if (
    (settings.quota.enabled || settings.respondentId.enabled) &&
    !settings.dimensions.length
  )
    problems.push("needsDimensions");
  if (settings.quota.checkAfter && !byKey.has(settings.quota.checkAfter))
    problems.push("checkAfter");
  if (settings.qc.minMinutes >= settings.qc.maxMinutes)
    problems.push("qcDuration");
  return [...new Set(problems)];
}

/**
 * The quota cell of an interview ("SBY-F-N"): one group code per dimension,
 * in dimension order. Null while any dimension is unanswered or unmapped.
 */
export function quotaCell(
  settings: CapiSettings,
  answers: Answers,
): string | null {
  if (!settings.dimensions.length) return null;
  const parts: string[] = [];
  for (const d of settings.dimensions) {
    const answer = answers[d.questionKey];
    if (!isChoiceAnswer(answer) || !answer.selected.length) return null;
    const id = answer.selected[0];
    const group = d.groups.find((g) => g.optionIds.includes(id));
    if (!group) return null;
    parts.push(group.code);
  }
  return parts.join("-");
}

/** Every cell of the quota matrix, in dimension order. */
export function allCells(settings: CapiSettings): string[] {
  return settings.dimensions
    .reduce<string[]>(
      (cells, d) =>
        cells.flatMap((prefix) =>
          d.groups.map((g) => (prefix ? `${prefix}-${g.code}` : g.code)),
        ),
      [""],
    )
    .filter(Boolean);
}

export type QcFlag =
  "duration_short" | "duration_long" | `straightline:${string}`;

/** Automatic QC flags of a completed interview. */
export function qcFlags(
  settings: CapiSettings,
  definition: FormDefinition,
  answers: Answers,
  durationSeconds: number | null,
): QcFlag[] {
  const flags: QcFlag[] = [];
  if (durationSeconds !== null) {
    if (durationSeconds < settings.qc.minMinutes * 60)
      flags.push("duration_short");
    if (durationSeconds > settings.qc.maxMinutes * 60)
      flags.push("duration_long");
  }
  for (const q of flattenQuestions(definition)) {
    if (q.type !== "grid" || !q.grid?.straightlining) continue;
    const answer = answers[q.key];
    if (!isGridAnswer(answer)) continue;
    const rows = Object.values(answer.rows).filter((cols) => cols.length === 1);
    if (rows.length >= 3 && rows.every((cols) => cols[0] === rows[0][0]))
      flags.push(`straightline:${q.code ?? q.key}`);
  }
  return flags;
}

export type Notes = Record<string, string>;

/** Visible questions whose interviewer note is required but empty. */
export function missingNotes(
  definition: FormDefinition,
  visibleKeys: Iterable<string>,
  notes: Notes,
): string[] {
  const visible = new Set(visibleKeys);
  return flattenQuestions(definition)
    .filter(
      (q) => q.noteRequired && visible.has(q.key) && !notes[q.key]?.trim(),
    )
    .map((q) => q.key);
}

/** Notes trimmed, empty ones dropped, only for known questions, capped. */
export function cleanNotes(definition: FormDefinition, notes: unknown): Notes {
  if (typeof notes !== "object" || notes === null) return {};
  const keys = new Set(flattenQuestions(definition).map((q) => q.key));
  const out: Notes = {};
  for (const [k, v] of Object.entries(notes as Record<string, unknown>)) {
    if (!keys.has(k) || typeof v !== "string") continue;
    const text = v.trim().slice(0, 2000);
    if (text) out[k] = text;
  }
  return out;
}

export type OtherShare = {
  key: string;
  code?: string;
  title: string;
  other: number;
  n: number;
  share: number;
};

/**
 * Questions where "Other" (option code 99 or the built-in Other) exceeds the
 * QC threshold: the pilot rule says to extend the option list.
 */
export function otherShares(
  questions: Record<
    string,
    {
      key: string;
      code?: string;
      title: string;
      options?: { id: string; code?: string }[];
    }
  >,
  stats: Record<
    string,
    {
      type: string;
      n: number;
      options?: { id: string; count: number }[];
      other?: number;
    }
  >,
  thresholdPercent: number,
): OtherShare[] {
  const out: OtherShare[] = [];
  for (const [key, s] of Object.entries(stats)) {
    const q = questions[key];
    if (!q || !s.options || s.n === 0) continue;
    const coded = new Set(
      (q.options ?? []).filter((o) => o.code === "99").map((o) => o.id),
    );
    const other =
      s.options
        .filter((o) => coded.has(o.id) || o.id === "__other__")
        .reduce((sum, o) => sum + o.count, 0) + (s.other ?? 0);
    const share = (other / s.n) * 100;
    if (other > 0 && share > thresholdPercent)
      out.push({ key, code: q.code, title: q.title, other, n: s.n, share });
  }
  return out.sort((a, b) => b.share - a.share);
}

/**
 * Settings for a copy of the form: the copy has new question keys
 * (cloneDefinitionWithNewKeys keeps question order and option ids).
 */
export function remapCapiKeys(
  settings: CapiSettings,
  from: FormDefinition,
  to: FormDefinition,
): CapiSettings {
  const next = flattenQuestions(to);
  const keys = new Map(
    flattenQuestions(from).map((q, i) => [q.key, next[i]?.key ?? q.key]),
  );
  const key = (k: string) => keys.get(k) ?? k;
  return {
    ...settings,
    dimensions: settings.dimensions.map((d) => ({
      ...d,
      questionKey: key(d.questionKey),
    })),
    quota: {
      ...settings.quota,
      ...(settings.quota.checkAfter
        ? { checkAfter: key(settings.quota.checkAfter) }
        : {}),
    },
  };
}
