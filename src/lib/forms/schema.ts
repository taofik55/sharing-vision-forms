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
  /** Rows x columns; one (or several) columns per row. */
  "grid",
  /** Pick up to N options in order of importance. */
  "ranking",
  /** GPS position of the device. */
  "location",
  /** Photo taken with the device camera. */
  "photo",
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
/** Types with a placeholder (hint text inside an empty field). */
export const PLACEHOLDER_TYPES = [
  "short_text",
  "paragraph",
  "email",
  "phone",
  "number",
  "dropdown",
] as const;

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "gt",
  "lt",
  "is_answered",
  "is_empty",
  /** Checkboxes / ranking: the option is not among the answers. */
  "not_contains",
  /** Same answer as another question (value = that question's key). */
  "same_as",
  "not_same_as",
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
  placeholder: 200,
  gridRows: 50,
  rules: 10,
  code: 20,
  optionCode: 10,
  /** Analysis keys (key__row) share the 64-character key limit. */
  key: 64,
} as const;

/** Types answered by picking options (stored as option ids). */
export const OPTION_TYPES = [
  "multiple_choice",
  "checkboxes",
  "dropdown",
  "ranking",
  "grid",
] as const;
export function hasOptions(type: QuestionType): boolean {
  return (OPTION_TYPES as readonly string[]).includes(type);
}

export function isChoiceType(type: QuestionType): type is ChoiceType {
  return (CHOICE_TYPES as readonly string[]).includes(type);
}
export function isTextType(type: QuestionType): boolean {
  return (TEXT_TYPES as readonly string[]).includes(type);
}
export function isNumericType(type: QuestionType): boolean {
  return (NUMERIC_TYPES as readonly string[]).includes(type);
}
export function supportsPlaceholder(type: QuestionType): boolean {
  return (PLACEHOLDER_TYPES as readonly string[]).includes(type);
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
      return [
        "equals",
        "not_equals",
        "same_as",
        "not_same_as",
        "is_answered",
        "is_empty",
      ];
    case "checkboxes":
    case "ranking":
      return [
        "contains",
        "not_contains",
        "same_as",
        "not_same_as",
        "is_answered",
        "is_empty",
      ];
    case "grid":
    case "location":
    case "photo":
      return ["is_answered", "is_empty"];
  }
}

/** Operators whose value is another question's key. */
export function operatorTakesQuestion(operator: ConditionOperator): boolean {
  return operator === "same_as" || operator === "not_same_as";
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
  /** Answer code for analysis / export (1, 2, 97, 98, 99). */
  code: z.string().trim().max(LIMITS.optionCode).optional(),
  /** Selecting it clears every other option (e.g. "None"). */
  exclusive: z.boolean().optional(),
});

/** Question code shown to interviewers and used in exports (S1, A2, G1). */
export const questionCodeSchema = z
  .string()
  .trim()
  .max(LIMITS.code)
  .regex(/^[A-Za-z0-9_.-]+$/);

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

export const gridSchema = z.strictObject({
  /** Rows (statements, attributes); columns are the question's options. */
  rows: z.array(optionSchema).max(LIMITS.gridRows),
  /** Several columns per row (MA) instead of one (SA). */
  multiple: z.boolean(),
  randomizeRows: z.boolean().optional(),
  /** Rows = the options picked in this earlier question (e.g. banks used). */
  rowsFrom: idSchema.optional(),
  /** At most N rows may pick this column (e.g. "never used" on 4 rows). */
  maxPerColumn: z
    .array(
      z.strictObject({
        optionId: idSchema,
        max: z.number().int().min(0).max(LIMITS.gridRows),
      }),
    )
    .max(10)
    .optional(),
  /** Flag interviews that give the same column on every row (QC). */
  straightlining: z.boolean().optional(),
});

export const rankingSchema = z.strictObject({
  /** Pick at most this many, in order. */
  max: z.number().int().min(1).max(20),
});

export const RULE_ACTIONS = ["terminate", "jump"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const ruleSchema = z.strictObject({
  /** Empty or missing = always (only meaningful for jumps). */
  when: conditionGroupSchema.optional(),
  /** terminate: end the interview as a screen-out. jump: skip ahead. */
  action: z.enum(RULE_ACTIONS),
  /** jump: a later section id or question key. */
  target: idSchema.optional(),
  /** Shown to the interviewer and stored with the screen-out. */
  reason: z.string().max(LIMITS.optionLabel).optional(),
});

export const optionsFromSchema = z.strictObject({
  questionKey: idSchema,
  /** selected: only options picked there; unselected: the others. */
  mode: z.enum(["selected", "unselected"]),
});

export const questionSchema = z.strictObject({
  id: idSchema,
  key: idSchema,
  type: z.enum(QUESTION_TYPES),
  title: z.string().max(LIMITS.title),
  description: z.string().max(LIMITS.description).optional(),
  /** Hint inside the empty field; the renderer falls back to "Your answer" / "Choose". */
  placeholder: z.string().max(LIMITS.placeholder).optional(),
  required: z.boolean(),
  options: z.array(optionSchema).max(LIMITS.options).optional(),
  allowOther: z.boolean().optional(),
  validation: validationRulesSchema.optional(),
  scale: scaleSchema.optional(),
  rating: ratingSchema.optional(),
  showIf: conditionGroupSchema.optional(),
  code: questionCodeSchema.optional(),
  grid: gridSchema.optional(),
  ranking: rankingSchema.optional(),
  randomizeOptions: z.boolean().optional(),
  /** Use the same random order as this question (G2 like G1). */
  orderLike: idSchema.optional(),
  /** Carry-forward: offer only the options picked in another question. */
  optionsFrom: optionsFromSchema.optional(),
  /** Checkboxes: options matching this question's answer are pre-ticked and locked. */
  autoSelectFrom: idSchema.optional(),
  /** The answer must differ from this question's answer. */
  notSameAs: idSchema.optional(),
  /** Screen-outs and jumps evaluated after this question. */
  rules: z.array(ruleSchema).max(LIMITS.rules).optional(),
  /** Interviewer must write a note for this question (CAPI). */
  noteRequired: z.boolean().optional(),
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
export type Grid = z.infer<typeof gridSchema>;
export type Rule = z.infer<typeof ruleSchema>;
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
  "duplicateCode",
  "tooFewRows",
  "emptyRowLabel",
  "duplicateRowId",
  "keyTooLong",
  "invalidRanking",
  "invalidReference",
  "ruleMissingTarget",
  "ruleUnknownTarget",
  "ruleBackwardJump",
  "ruleTerminateWithoutCondition",
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
  const seenCodes = new Set<string>();
  // Flow positions of questions and sections (a section = its first question).
  const positions = new Map<string, number>();
  {
    let i = 0;
    for (const section of definition.sections) {
      // A section starts right before its first question.
      positions.set(section.id, i - 0.5);
      for (const q of section.questions) positions.set(q.key, i++);
    }
  }

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

      if (q.code) {
        const code = q.code.toUpperCase();
        if (seenCodes.has(code))
          problems.push({ code: "duplicateCode", ...at });
        seenCodes.add(code);
      }

      if (hasOptions(q.type)) {
        const options = q.options ?? [];
        if (options.length < 2) problems.push({ code: "tooFewOptions", ...at });
        if (options.some((o) => !o.label.trim()))
          problems.push({ code: "emptyOptionLabel", ...at });
        const ids = options.map((o) => o.id);
        if (new Set(ids).size !== ids.length || ids.includes(OTHER_OPTION_ID)) {
          problems.push({ code: "duplicateOptionId", ...at });
        }
      }

      if (q.type === "grid") problems.push(...validateGrid(q, at, earlier));
      if (q.type === "ranking") {
        const max = q.ranking?.max;
        if (
          !max ||
          (!q.optionsFrom &&
            max > (q.options?.length ?? 0) + (q.allowOther ? 1 : 0))
        )
          problems.push({ code: "invalidRanking", ...at });
        if (q.key.length + 4 > LIMITS.key)
          problems.push({ code: "keyTooLong", ...at });
      }
      problems.push(...validateReferences(q, at, earlier));

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
        problems.push(...validateConditions(q.showIf, at, earlier, allKeys));

      // Rules may read this question's own answer.
      const withSelf = new Map(earlier).set(q.key, q);
      for (const rule of q.rules ?? []) {
        const hasWhen = (rule.when?.conditions.length ?? 0) > 0;
        if (hasWhen)
          problems.push(
            ...validateConditions(rule.when!, at, withSelf, allKeys),
          );
        if (rule.action === "terminate" && !hasWhen)
          problems.push({ code: "ruleTerminateWithoutCondition", ...at });
        if (rule.action === "jump") {
          if (!rule.target) {
            problems.push({ code: "ruleMissingTarget", ...at });
            continue;
          }
          const position = positions.get(rule.target);
          if (position === undefined)
            problems.push({ code: "ruleUnknownTarget", ...at });
          else if (position <= positions.get(q.key)!)
            problems.push({ code: "ruleBackwardJump", ...at });
        }
      }

      earlier.set(q.key, q);
    }
  }

  if (questionCount === 0) problems.push({ code: "noQuestions" });
  return problems;
}

type At = { sectionId: string; questionId: string };

function validateConditions(
  group: ConditionGroup,
  at: At,
  earlier: Map<string, Question>,
  allKeys: Set<string>,
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
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
    if (operatorTakesQuestion(c.operator)) {
      const other = earlier.get(String(c.value));
      if (!other || !hasOptions(other.type))
        problems.push({ code: "conditionInvalidValue", ...at });
      continue;
    }
    if (!isConditionValueValid(ref, c.value))
      problems.push({ code: "conditionInvalidValue", ...at });
  }
  return problems;
}

/** References to other questions must point at an earlier question of a fitting type. */
function validateReferences(
  q: Question,
  at: At,
  earlier: Map<string, Question>,
): DefinitionProblem[] {
  const pick = (key: string | undefined, ok: (ref: Question) => boolean) =>
    key !== undefined && !(earlier.has(key) && ok(earlier.get(key)!));
  const choice = (ref: Question) => hasOptions(ref.type) && ref.type !== "grid";
  const bad =
    pick(q.optionsFrom?.questionKey, choice) ||
    pick(q.autoSelectFrom, choice) ||
    pick(q.notSameAs, choice) ||
    pick(q.grid?.rowsFrom, choice) ||
    (q.orderLike !== undefined &&
      !(earlier.has(q.orderLike) || q.orderLike === q.key)) ||
    (q.optionsFrom !== undefined && !hasOptions(q.type)) ||
    (q.autoSelectFrom !== undefined && q.type !== "checkboxes") ||
    (q.notSameAs !== undefined && !isChoiceType(q.type));
  return bad ? [{ code: "invalidReference", ...at }] : [];
}

function validateGrid(
  q: Question,
  at: At,
  earlier: Map<string, Question>,
): DefinitionProblem[] {
  const problems: DefinitionProblem[] = [];
  const grid = q.grid;
  if (!grid) return [{ code: "tooFewRows", ...at }];
  const rows = grid.rowsFrom
    ? (earlier.get(grid.rowsFrom)?.options ?? [])
    : grid.rows;
  if (!grid.rowsFrom && rows.length < 1)
    problems.push({ code: "tooFewRows", ...at });
  if (!grid.rowsFrom && rows.some((r) => !r.label.trim()))
    problems.push({ code: "emptyRowLabel", ...at });
  const ids = rows.map((r) => r.id);
  if (new Set(ids).size !== ids.length)
    problems.push({ code: "duplicateRowId", ...at });
  if (ids.some((id) => q.key.length + 2 + id.length > LIMITS.key))
    problems.push({ code: "keyTooLong", ...at });
  const columns = new Set((q.options ?? []).map((o) => o.id));
  if ((grid.maxPerColumn ?? []).some((m) => !columns.has(m.optionId)))
    problems.push({ code: "invalidReference", ...at });
  return problems;
}

function isConditionValueValid(ref: Question, value: string | number): boolean {
  if (hasOptions(ref.type)) {
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
