/**
 * Answer validation, shared by the renderer (client, per page) and the
 * submission route (server, whole form). Error messages are i18n codes
 * (see the `renderer.errors` namespace in messages/*.json).
 */
import { z } from "zod";
import {
  effectiveOptions,
  effectiveRows,
  getVisibleKeys,
  isAnswerEmpty,
  lockedOptionIds,
  logicContext,
  matchOption,
  selectedOptions,
  type Answers,
  type LogicContext,
} from "./logic";
import {
  OTHER_OPTION_ID,
  flattenQuestions,
  isValidIsoDate,
  isValidPattern,
  type FormDefinition,
  type Question,
} from "./schema";

export const ANSWER_ERROR_CODES = [
  "required",
  "invalid",
  "tooShort",
  "tooLong",
  "patternMismatch",
  "invalidEmail",
  "invalidPhone",
  "notInteger",
  "tooSmall",
  "tooLarge",
  "invalidDate",
  "dateTooEarly",
  "dateTooLate",
  "invalidOption",
  "otherRequired",
  "tooFewSelections",
  "tooManySelections",
  /** "None"-type option picked together with others. */
  "exclusiveOption",
  /** A grid row was left empty. */
  "rowsRequired",
  /** Too many grid rows on one column (e.g. "never used"). */
  "tooManyInColumn",
  /** Same answer as a question it must differ from. */
  "sameAsOther",
  /** An option carried over from an earlier answer was removed. */
  "lockedOption",
  "invalidLocation",
  "invalidPhoto",
] as const;
export type AnswerErrorCode = (typeof ANSWER_ERROR_CODES)[number];

export const TEXT_DEFAULT_MAX = {
  short_text: 500,
  paragraph: 5000,
  email: 320,
  phone: 30,
  otherText: 500,
} as const;

const PHONE_PATTERN = /^\+?[0-9\s().-]+$/;

function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return isAnswerEmpty(value) ? undefined : value;
}

function textSchema(q: Question, defaultMax: number) {
  const v = q.validation ?? {};
  let schema = z
    .string({ error: "invalid" })
    .max(Math.min(v.maxLength ?? defaultMax, defaultMax), { error: "tooLong" });
  if (v.minLength) schema = schema.min(v.minLength, { error: "tooShort" });
  if (v.pattern && isValidPattern(v.pattern)) {
    // Full-match semantics. Input length is capped above, which bounds regex cost.
    const regex = new RegExp(`^(?:${v.pattern})$`, "u");
    schema = schema.regex(regex, { error: "patternMismatch" });
  }
  return schema;
}

function numberSchema(q: Question) {
  const v = q.validation ?? {};
  let schema = z.number({ error: "invalid" });
  if (v.integerOnly) schema = schema.int({ error: "notInteger" });
  if (v.min !== undefined) schema = schema.min(v.min, { error: "tooSmall" });
  if (v.max !== undefined) schema = schema.max(v.max, { error: "tooLarge" });
  return z.preprocess((value) => {
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return value;
  }, schema);
}

function rangeSchema(min: number, max: number) {
  return z
    .number({ error: "invalid" })
    .int({ error: "invalid" })
    .min(min, { error: "tooSmall" })
    .max(max, { error: "tooLarge" });
}

function dateSchema(q: Question) {
  const v = q.validation ?? {};
  return z
    .string({ error: "invalidDate" })
    .refine(isValidIsoDate, { error: "invalidDate" })
    .refine((d) => !v.minDate || d >= v.minDate, { error: "dateTooEarly" })
    .refine((d) => !v.maxDate || d <= v.maxDate, { error: "dateTooLate" });
}

/** Photo data URLs (JPEG/PNG/WebP) up to ~2 MB of base64. */
export const MAX_PHOTO_CHARS = 2_800_000;
const PHOTO_PATTERN =
  /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|id:[0-9a-f-]{36})$/;

function choiceSchema(q: Question, logic: LogicContext) {
  const options = effectiveOptions(q, logic);
  const allowed = new Set(options.map((o) => o.id));
  if (q.allowOther) allowed.add(OTHER_OPTION_ID);
  const multiple = q.type === "checkboxes" || q.type === "ranking";
  const exclusive = new Set(
    options.filter((o) => o.exclusive).map((o) => o.id),
  );
  const locked = lockedOptionIds(q, logic);
  const other = q.notSameAs ? logic.byKey.get(q.notSameAs) : undefined;
  const v = q.validation ?? {};
  const max = q.type === "ranking" ? (q.ranking?.max ?? allowed.size) : v.max;

  return z
    .strictObject(
      {
        selected: z.array(z.string()).max(allowed.size),
        otherText: z
          .string()
          .max(TEXT_DEFAULT_MAX.otherText, { error: "tooLong" })
          .optional(),
      },
      { error: "invalid" },
    )
    .superRefine((value, ctx) => {
      const { selected } = value;
      if (
        new Set(selected).size !== selected.length ||
        selected.some((id) => !allowed.has(id))
      ) {
        ctx.addIssue({ code: "custom", message: "invalidOption" });
        return;
      }
      if (!multiple && selected.length !== 1) {
        ctx.addIssue({ code: "custom", message: "invalid" });
        return;
      }
      if (selected.includes(OTHER_OPTION_ID) && !value.otherText?.trim()) {
        ctx.addIssue({ code: "custom", message: "otherRequired" });
      }
      if (selected.length > 1 && selected.some((id) => exclusive.has(id))) {
        ctx.addIssue({ code: "custom", message: "exclusiveOption" });
        return;
      }
      if (locked.some((id) => !selected.includes(id))) {
        ctx.addIssue({ code: "custom", message: "lockedOption" });
        return;
      }
      if (multiple && v.min !== undefined && selected.length < v.min) {
        ctx.addIssue({ code: "custom", message: "tooFewSelections" });
      }
      if (multiple && max !== undefined && selected.length > max) {
        ctx.addIssue({ code: "custom", message: "tooManySelections" });
      }
      if (other) {
        const picked = selectedOptions(other, logic.answers[other.key]);
        const mine = options.filter((o) => selected.includes(o.id));
        if (mine.some((o) => matchOption(o, picked)))
          ctx.addIssue({ code: "custom", message: "sameAsOther" });
      }
    })
    .transform(({ selected, otherText }) =>
      selected.includes(OTHER_OPTION_ID) && otherText?.trim()
        ? { selected, otherText: otherText.trim() }
        : { selected },
    );
}

function gridSchema(q: Question, logic: LogicContext, required: boolean) {
  const rows = effectiveRows(q, logic);
  const rowIds = new Set(rows.map((r) => r.id));
  const columns = new Set((q.options ?? []).map((o) => o.id));
  const exclusive = new Set(
    (q.options ?? []).filter((o) => o.exclusive).map((o) => o.id),
  );
  const multiple = q.grid?.multiple ?? false;
  const limits = q.grid?.maxPerColumn ?? [];
  return z
    .strictObject(
      {
        rows: z.record(
          z.string().max(64),
          z.array(z.string()).max(Math.max(columns.size, 1)),
        ),
      },
      { error: "invalid" },
    )
    .superRefine((value, ctx) => {
      for (const [rowId, cols] of Object.entries(value.rows)) {
        if (
          !rowIds.has(rowId) ||
          cols.some((c) => !columns.has(c)) ||
          new Set(cols).size !== cols.length
        ) {
          ctx.addIssue({ code: "custom", message: "invalidOption" });
          return;
        }
        if (!multiple && cols.length > 1) {
          ctx.addIssue({ code: "custom", message: "invalid" });
          return;
        }
        if (cols.length > 1 && cols.some((c) => exclusive.has(c))) {
          ctx.addIssue({ code: "custom", message: "exclusiveOption" });
          return;
        }
      }
      if (required && rows.some((r) => !value.rows[r.id]?.length)) {
        ctx.addIssue({ code: "custom", message: "rowsRequired" });
        return;
      }
      for (const limit of limits) {
        const n = Object.values(value.rows).filter((cols) =>
          cols.includes(limit.optionId),
        ).length;
        if (n > limit.max) {
          ctx.addIssue({ code: "custom", message: "tooManyInColumn" });
          return;
        }
      }
    })
    .transform(({ rows: answered }) => ({
      rows: Object.fromEntries(
        Object.entries(answered).filter(([, cols]) => cols.length > 0),
      ),
    }));
}

const locationSchema = z.strictObject(
  {
    lat: z.number({ error: "invalidLocation" }).min(-90).max(90),
    lng: z.number({ error: "invalidLocation" }).min(-180).max(180),
    accuracy: z.number().min(0).max(100_000).optional(),
  },
  { error: "invalidLocation" },
);

const photoSchema = z.strictObject(
  {
    photo: z
      .string({ error: "invalidPhoto" })
      .max(MAX_PHOTO_CHARS, { error: "invalidPhoto" })
      .regex(PHOTO_PATTERN, { error: "invalidPhoto" }),
  },
  { error: "invalidPhoto" },
);

const NO_CONTEXT: LogicContext = { answers: {}, byKey: new Map() };

/**
 * Zod schema for one question's answer, ignoring `required` (except that a
 * required grid needs every row). Carried-over options and rows come from
 * the other answers in `logic`.
 */
export function questionValueSchema(
  q: Question,
  logic: LogicContext = NO_CONTEXT,
): z.ZodType {
  switch (q.type) {
    case "short_text":
    case "paragraph":
      return textSchema(q, TEXT_DEFAULT_MAX[q.type]);
    case "email":
      return z
        .string({ error: "invalid" })
        .max(TEXT_DEFAULT_MAX.email, { error: "tooLong" })
        .pipe(z.email({ error: "invalidEmail" }));
    case "phone":
      return z
        .string({ error: "invalid" })
        .max(TEXT_DEFAULT_MAX.phone, { error: "tooLong" })
        .regex(PHONE_PATTERN, { error: "invalidPhone" })
        .refine(
          (p) => {
            const digits = p.replace(/\D/g, "").length;
            return digits >= 6 && digits <= 15;
          },
          { error: "invalidPhone" },
        );
    case "number":
      return numberSchema(q);
    case "rating":
      return rangeSchema(1, q.rating?.max ?? 5);
    case "linear_scale":
      return rangeSchema(q.scale?.min ?? 1, q.scale?.max ?? 5);
    case "date":
      return dateSchema(q);
    case "multiple_choice":
    case "checkboxes":
    case "dropdown":
    case "ranking":
      return choiceSchema(q, logic);
    case "grid":
      return gridSchema(q, logic, q.required);
    case "location":
      return locationSchema;
    case "photo":
      return photoSchema;
  }
}

function answerSchema(q: Question, logic: LogicContext): z.ZodType {
  const inner = questionValueSchema(q, logic);
  if (q.required) {
    return z.preprocess(
      normalize,
      z
        .any()
        .refine((v) => v !== undefined, { error: "required", abort: true })
        .pipe(inner),
    );
  }
  return z.preprocess(normalize, inner.optional());
}

/**
 * Zod object schema for the answers of the given visible question keys.
 * Hidden questions are not part of the schema, so their answers are stripped.
 */
export function buildAnswerSchema(
  definition: FormDefinition,
  visibleKeys: Iterable<string>,
  answers: Answers = {},
) {
  const keys = new Set(visibleKeys);
  const logic = logicContext(definition, answers);
  const shape: Record<string, z.ZodType> = {};
  for (const q of flattenQuestions(definition)) {
    if (keys.has(q.key)) shape[q.key] = answerSchema(q, logic);
  }
  return z.object(shape);
}

export type AnswerErrors = Record<string, AnswerErrorCode>;

function toErrorCode(message: string): AnswerErrorCode {
  return (ANSWER_ERROR_CODES as readonly string[]).includes(message)
    ? (message as AnswerErrorCode)
    : "invalid";
}

/**
 * Validates answers for the visible questions (optionally restricted to a
 * subset, e.g. one page). Returns cleaned answers or one error per question.
 */
export function validateAnswers(
  definition: FormDefinition,
  answers: Answers,
  onlyKeys?: Iterable<string>,
): { ok: true; data: Answers } | { ok: false; errors: AnswerErrors } {
  let keys = getVisibleKeys(definition, answers);
  if (onlyKeys) {
    const subset = new Set(onlyKeys);
    keys = new Set([...keys].filter((k) => subset.has(k)));
  }
  const result = buildAnswerSchema(definition, keys, answers).safeParse(
    answers,
  );
  if (result.success) return { ok: true, data: result.data as Answers };

  const errors: AnswerErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = toErrorCode(issue.message);
  }
  return { ok: false, errors };
}
