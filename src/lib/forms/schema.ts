/**
 * THE form definition schema. Shared by the builder, the renderer, server
 * validation and analytics. Do not define a second one anywhere else.
 *
 * - Every question has a stable `key` (nanoid) that never changes across
 *   versions. Answers and analytics reference `key`, never position.
 * - `formDefinitionSchema` checks structure (safe to store as a draft).
 * - `validateDefinition()` adds the semantic checks required to publish.
 */
import { z } from "zod";

export const QUESTION_TYPES = [
  "short_text",
  "paragraph",
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "number",
  "date",
  "rating",
  "linear_scale",
  "email",
  "phone",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES = [
  "multiple_choice",
  "checkboxes",
  "dropdown",
] as const;
export type ChoiceType = (typeof CHOICE_TYPES)[number];
export const TEXT_TYPES = [
  "short_text",
  "paragraph",
  "email",
  "phone",
] as const;
export const NUMERIC_TYPES = ["number", "rating", "linear_scale"] as const;

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "gt",
  "lt",
  "is_answered",
  "is_empty",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Reserved option id used when a respondent picks "Other". */
export const OTHER_OPTION_ID = "__other__";

export const LIMITS = {
  sections: 50,
  questions: 300,
  options: 200,
  conditions: 20,
  title: 500,
  description: 2000,
  optionLabel: 300,
  pattern: 200,
  scaleLabel: 100,
} as const;

export function isChoiceType(type: QuestionType): type is ChoiceType {
  return (CHOICE_TYPES as readonly string[]).includes(type);
}
export function isTextType(type: QuestionType): boolean {
  return (TEXT_TYPES as readonly string[]).includes(type);
}
export function isNumericType(type: QuestionType): boolean {
  return (NUMERIC_TYPES as readonly string[]).includes(type);
}

/** Operators that make sense for a referenced question of this type. */
export function operatorsForType(type: QuestionType): ConditionOperator[] {
  switch (type) {
    case "short_text":
    case "paragraph":
    case "email":
    case "phone":
      return ["equals", "not_equals", "contains", "is_answered", "is_empty"];
    case "number":
    case "rating":
    case "linear_scale":
    case "date":
      return ["equals", "not_equals", "gt", "lt", "is_answered", "is_empty"];
    case "multiple_choice":
    case "dropdown":
      return ["equals", "not_equals", "is_answered", "is_empty"];
    case "checkboxes":
      return ["contains", "is_answered", "is_empty"];
  }
}

export function operatorNeedsValue(operator: ConditionOperator): boolean {
  return operator !== "is_answered" && operator !== "is_empty";
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const optionSchema = z.strictObject({
  id: idSchema,
  label: z.string().max(LIMITS.optionLabel),
});

export const validationRulesSchema = z.strictObject({
  minLength: z.number().int().min(0).max(100_000).optional(),
  maxLength: z.number().int().min(1).max(100_000).optional(),
  pattern: z.string().max(LIMITS.pattern).optional(),
  /** number: value bounds. checkboxes: selection count bounds. */
  min: z.number().optional(),
  max: z.number().optional(),
  integerOnly: z.boolean().optional(),
  minDate: isoDateSchema.optional(),
  maxDate: isoDateSchema.optional(),
});

export const scaleSchema = z.strictObject({
  min: z.union([z.literal(0), z.literal(1)]),
  max: z.number().int().min(3).max(10),
  minLabel: z.string().max(LIMITS.scaleLabel).optional(),
  maxLabel: z.string().max(LIMITS.scaleLabel).optional(),
});

export const ratingSchema = z.strictObject({
  max: z.number().int().min(3).max(10),
});

export const conditionSchema = z.strictObject({
  questionKey: idSchema,
  operator: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(LIMITS.optionLabel), z.number()]).optional(),
});

export const conditionGroupSchema = z.strictObject({
  combinator: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema).max(LIMITS.conditions),
});

export const questionSchema = z.strictObject({
  id: idSchema,
  key: idSchema,
  type: z.enum(QUESTION_TYPES),
  title: z.string().max(LIMITS.title),
  description: z.string().max(LIMITS.description).optional(),
  required: z.boolean(),
  options: z.array(optionSchema).max(LIMITS.options).optional(),
  allowOther: z.boolean().optional(),
  validation: validationRulesSchema.optional(),
  scale: scaleSchema.optional(),
  rating: ratingSchema.optional(),
  showIf: conditionGroupSchema.optional(),
});

export const sectionSchema = z.strictObject({
  id: idSchema,
  title: z.string().max(LIMITS.title),
  description: z.string().max(LIMITS.description).optional(),
  questions: z.array(questionSchema).max(LIMITS.questions),
});

export const formDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sections: z.array(sectionSchema).min(1).max(LIMITS.sections),
  })
  .refine(
    (def) =>
      def.sections.reduce((n, s) => n + s.questions.length, 0) <=
      LIMITS.questions,
    { error: "tooManyQuestions" },
  );

export type Option = z.infer<typeof optionSchema>;
export type ValidationRules = z.infer<typeof validationRulesSchema>;
export type Scale = z.infer<typeof scaleSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

// ---------------------------------------------------------------------------
// Semantic validation (required to publish)
// ---------------------------------------------------------------------------

export const PROBLEM_CODES = [
  "invalidStructure",
  "noQuestions",
  "emptySectionTitle",
  "emptyQuestionTitle",
  "duplicateId",
  "duplicateKey",
  "tooFewOptions",
  "emptyOptionLabel",
  "duplicateOptionId",
  "invalidPattern",
  "invalidLengthRange",
  "invalidNumberRange",
  "invalidDateRange",
  "invalidSelectionRange",
  "missingScale",
  "missingRating",
  "conditionEmpty",
  "conditionUnknownQuestion",
  "conditionForwardReference",
  "conditionInvalidOperator",
  "conditionMissingValue",
  "conditionInvalidValue",
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export type DefinitionProblem = {
  code: ProblemCode;
  sectionId?: string;
  questionId?: string;
};

export function isValidIsoDate(value: string): boolean {
  if (!isoDateSchema.safeParse(value).success) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

/** Semantic checks on a structurally valid definition. Empty array = publishable. */
export function validateDefinition(
  definition: FormDefinition,
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  // key -> question, only for questions located earlier than the current one
  const earlier = new Map<string, Question>();
  const allKeys = new Set(
    definition.sections.flatMap((s) => s.questions.map((q) => q.key)),
  );
  let questionCount = 0;

  for (const section of definition.sections) {
    if (seenIds.has(section.id))
      problems.push({ code: "duplicateId", sectionId: section.id });
    seenIds.add(section.id);
    if (!section.title.trim())
      problems.push({ code: "emptySectionTitle", sectionId: section.id });

    for (const q of section.questions) {
      questionCount++;
      const at = { sectionId: section.id, questionId: q.id };
      if (seenIds.has(q.id)) problems.push({ code: "duplicateId", ...at });
      seenIds.add(q.id);
      if (seenKeys.has(q.key)) problems.push({ code: "duplicateKey", ...at });
      seenKeys.add(q.key);
      if (!q.title.trim()) problems.push({ code: "emptyQuestionTitle", ...at });

      if (isChoiceType(q.type)) {
        const options = q.options ?? [];
        if (options.length < 2) problems.push({ code: "tooFewOptions", ...at });
        if (options.some((o) => !o.label.trim()))
          problems.push({ code: "emptyOptionLabel", ...at });
        const ids = options.map((o) => o.id);
        if (new Set(ids).size !== ids.length || ids.includes(OTHER_OPTION_ID)) {
          problems.push({ code: "duplicateOptionId", ...at });
        }
      }

      const v = q.validation;
      if (v) {
        if (v.pattern && !isValidPattern(v.pattern))
          problems.push({ code: "invalidPattern", ...at });
        if (
          v.minLength !== undefined &&
          v.maxLength !== undefined &&
          v.minLength > v.maxLength
        ) {
          problems.push({ code: "invalidLengthRange", ...at });
        }
        if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
          problems.push({
            code:
              q.type === "checkboxes"
                ? "invalidSelectionRange"
                : "invalidNumberRange",
            ...at,
          });
        }
        if (
          (v.minDate && !isValidIsoDate(v.minDate)) ||
          (v.maxDate && !isValidIsoDate(v.maxDate)) ||
          (v.minDate && v.maxDate && v.minDate > v.maxDate)
        ) {
          problems.push({ code: "invalidDateRange", ...at });
        }
      }
      if (q.type === "linear_scale" && !q.scale)
        problems.push({ code: "missingScale", ...at });
      if (q.type === "rating" && !q.rating)
        problems.push({ code: "missingRating", ...at });

      if (q.showIf)
        problems.push(...validateConditions(q, at, earlier, allKeys));

      earlier.set(q.key, q);
    }
  }

  if (questionCount === 0) problems.push({ code: "noQuestions" });
  return problems;
}

function validateConditions(
  q: Question,
  at: { sectionId: string; questionId: string },
  earlier: Map<string, Question>,
  allKeys: Set<string>,
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const group = q.showIf!;
  if (group.conditions.length === 0) return [{ code: "conditionEmpty", ...at }];

  for (const c of group.conditions) {
    const ref = earlier.get(c.questionKey);
    if (!ref) {
      problems.push({
        code: allKeys.has(c.questionKey)
          ? "conditionForwardReference"
          : "conditionUnknownQuestion",
        ...at,
      });
      continue;
    }
    if (!operatorsForType(ref.type).includes(c.operator)) {
      problems.push({ code: "conditionInvalidOperator", ...at });
      continue;
    }
    if (!operatorNeedsValue(c.operator)) continue;
    if (c.value === undefined || c.value === "") {
      problems.push({ code: "conditionMissingValue", ...at });
      continue;
    }
    if (!isConditionValueValid(ref, c.value))
      problems.push({ code: "conditionInvalidValue", ...at });
  }
  return problems;
}

function isConditionValueValid(ref: Question, value: string | number): boolean {
  if (isChoiceType(ref.type)) {
    const ids = (ref.options ?? []).map((o) => o.id);
    if (ref.allowOther) ids.push(OTHER_OPTION_ID);
    return typeof value === "string" && ids.includes(value);
  }
  if (isNumericType(ref.type))
    return typeof value === "number" && Number.isFinite(value);
  if (ref.type === "date")
    return typeof value === "string" && isValidIsoDate(value);
  return typeof value === "string";
}

/** Parse unknown JSON and run semantic validation. */
export function parseAndValidateDefinition(
  input: unknown,
):
  | { ok: true; definition: FormDefinition }
  | { ok: false; definition?: FormDefinition; problems: DefinitionProblem[] } {
  const parsed = formDefinitionSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, problems: [{ code: "invalidStructure" }] };
  const problems = validateDefinition(parsed.data);
  return problems.length
    ? { ok: false, definition: parsed.data, problems }
    : { ok: true, definition: parsed.data };
}

export function flattenQuestions(definition: FormDefinition): Question[] {
  return definition.sections.flatMap((s) => s.questions);
}
