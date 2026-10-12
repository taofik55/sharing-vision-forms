/**
 * Conditional logic, shared by the builder preview, the public renderer and
 * server-side submission validation. Pure functions only.
 */
import {
  flattenQuestions,
  isChoiceType,
  isNumericType,
  type Condition,
  type ConditionGroup,
  type FormDefinition,
  type Question,
  type Section,
} from "./schema";

/** Choice answers: selected option ids (may include OTHER_OPTION_ID) + "Other" text. */
export type ChoiceAnswer = { selected: string[]; otherText?: string };
export type AnswerValue = string | number | ChoiceAnswer;
export type Answers = Record<string, AnswerValue | undefined>;

export function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ChoiceAnswer).selected)
  );
}

export function isAnswerEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (isChoiceAnswer(value)) return value.selected.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function equalsValue(
  question: Question,
  answer: AnswerValue,
  value: Condition["value"],
): boolean {
  if (isChoiceType(question.type)) {
    return (
      isChoiceAnswer(answer) &&
      typeof value === "string" &&
      answer.selected.includes(value)
    );
  }
  if (isNumericType(question.type)) {
    const a = toNumber(answer);
    const b = toNumber(value);
    return a !== null && b !== null && a === b;
  }
  if (question.type === "date") return String(answer) === String(value);
  return normalizeText(answer) === normalizeText(value);
}

function compare(
  question: Question,
  answer: AnswerValue,
  value: Condition["value"],
): number | null {
  if (question.type === "date") {
    const a = String(answer);
    const b = String(value ?? "");
    if (!a || !b) return null;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = toNumber(answer);
  const b = toNumber(value);
  if (a === null || b === null) return null;
  return a - b;
}

/**
 * Evaluates one condition against the referenced question's answer.
 * Unknown questions evaluate to false. Empty answers: only `is_empty` and
 * `not_equals` are true.
 */
export function evaluateCondition(
  condition: Condition,
  answers: Answers,
  questionsByKey: Map<string, Question>,
): boolean {
  const question = questionsByKey.get(condition.questionKey);
  if (!question) return false;
  const answer = answers[condition.questionKey];
  const empty = isAnswerEmpty(answer);

  switch (condition.operator) {
    case "is_answered":
      return !empty;
    case "is_empty":
      return empty;
    case "equals":
      return !empty && equalsValue(question, answer!, condition.value);
    case "not_equals":
      return empty || !equalsValue(question, answer!, condition.value);
    case "contains":
      if (empty) return false;
      if (isChoiceType(question.type))
        return equalsValue(question, answer!, condition.value);
      return normalizeText(answer).includes(normalizeText(condition.value));
    case "gt": {
      if (empty) return false;
      const c = compare(question, answer!, condition.value);
      return c !== null && c > 0;
    }
    case "lt": {
      if (empty) return false;
      const c = compare(question, answer!, condition.value);
      return c !== null && c < 0;
    }
  }
}

export function evaluateConditionGroup(
  group: ConditionGroup | undefined,
  answers: Answers,
  questionsByKey: Map<string, Question>,
): boolean {
  if (!group || group.conditions.length === 0) return true;
  const results = group.conditions.map((c) =>
    evaluateCondition(c, answers, questionsByKey),
  );
  return group.combinator === "and"
    ? results.every(Boolean)
    : results.some(Boolean);
}

/**
 * Questions visible for the given answers, in form order. A question hidden
 * by its own condition contributes an EMPTY answer to later conditions, so
 * chains of hidden questions collapse correctly.
 */
export function getVisibleQuestions(
  definition: FormDefinition,
  answers: Answers,
): Question[] {
  const questionsByKey = new Map(
    flattenQuestions(definition).map((q) => [q.key, q]),
  );
  const effective: Answers = {};
  const visible: Question[] = [];
  for (const question of flattenQuestions(definition)) {
    if (evaluateConditionGroup(question.showIf, effective, questionsByKey)) {
      visible.push(question);
      effective[question.key] = answers[question.key];
    }
  }
  return visible;
}

export function getVisibleKeys(
  definition: FormDefinition,
  answers: Answers,
): Set<string> {
  return new Set(getVisibleQuestions(definition, answers).map((q) => q.key));
}

/** Sections that contain at least one visible question (each section = one page). */
export function getVisibleSections(
  definition: FormDefinition,
  answers: Answers,
): Section[] {
  const keys = getVisibleKeys(definition, answers);
  return definition.sections.filter((s) =>
    s.questions.some((q) => keys.has(q.key)),
  );
}
