/**
 * Answer validation, shared by the renderer (client, per page) and the
 * submission route (server, whole form). Error messages are i18n codes
 * (see the `renderer.errors` namespace in messages/*.json).
 */
import { z } from "zod";
import { getVisibleKeys, isAnswerEmpty, type Answers } from "./logic";
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

function choiceSchema(q: Question) {
  const allowed = new Set((q.options ?? []).map((o) => o.id));
  if (q.allowOther) allowed.add(OTHER_OPTION_ID);
  const multiple = q.type === "checkboxes";
  const v = q.validation ?? {};

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
      if (multiple && v.min !== undefined && selected.length < v.min) {
        ctx.addIssue({ code: "custom", message: "tooFewSelections" });
      }
      if (multiple && v.max !== undefined && selected.length > v.max) {
        ctx.addIssue({ code: "custom", message: "tooManySelections" });
      }
    })
    .transform(({ selected, otherText }) =>
      selected.includes(OTHER_OPTION_ID) && otherText?.trim()
        ? { selected, otherText: otherText.trim() }
        : { selected },
    );
}

/** Zod schema for one question's answer, ignoring `required`. */
export function questionValueSchema(q: Question): z.ZodType {
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
      return choiceSchema(q);
  }
}

function answerSchema(q: Question): z.ZodType {
  const inner = questionValueSchema(q);
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
) {
  const keys = new Set(visibleKeys);
  const shape: Record<string, z.ZodType> = {};
  for (const q of flattenQuestions(definition)) {
    if (keys.has(q.key)) shape[q.key] = answerSchema(q);
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
  const result = buildAnswerSchema(definition, keys).safeParse(answers);
  if (result.success) return { ok: true, data: result.data as Answers };

  const errors: AnswerErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = toErrorCode(issue.message);
  }
  return { ok: false, errors };
}
