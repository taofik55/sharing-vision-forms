/**
 * Conditional logic, shared by the builder preview, the public renderer, the
 * interview runner and server-side submission validation. Pure functions only.
 *
 * Flow: questions are walked in form order. A question is shown when its
 * `showIf` holds; after it, its `rules` may end the interview (screen-out) or
 * jump ahead to a later question or section. Hidden or skipped questions
 * count as unanswered for everything after them.
 */
import {
  OTHER_OPTION_ID,
  flattenQuestions,
  hasOptions,
  isNumericType,
  type Condition,
  type ConditionGroup,
  type FormDefinition,
  type Option,
  type Question,
  type Rule,
  type Section,
} from "./schema";

/** Choice answers: selected option ids (may include OTHER_OPTION_ID) + "Other" text. Ranking: in order. */
export type ChoiceAnswer = { selected: string[]; otherText?: string };
/** Grid answers: column ids per row id. */
export type GridAnswer = { rows: Record<string, string[]> };
export type LocationAnswer = { lat: number; lng: number; accuracy?: number };
/** A data URL while filling in; `id:<uuid>` once stored. */
export type PhotoAnswer = { photo: string };
export type AnswerValue =
  string | number | ChoiceAnswer | GridAnswer | LocationAnswer | PhotoAnswer;
export type Answers = Record<string, AnswerValue | undefined>;

export function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ChoiceAnswer).selected)
  );
}

export function isGridAnswer(value: unknown): value is GridAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GridAnswer).rows === "object" &&
    (value as GridAnswer).rows !== null &&
    !Array.isArray((value as GridAnswer).rows)
  );
}

export function isLocationAnswer(value: unknown): value is LocationAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LocationAnswer).lat === "number" &&
    typeof (value as LocationAnswer).lng === "number"
  );
}

export function isPhotoAnswer(value: unknown): value is PhotoAnswer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PhotoAnswer).photo === "string"
  );
}

export function isAnswerEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (isChoiceAnswer(value)) return value.selected.length === 0;
  if (isGridAnswer(value))
    return !Object.values(value.rows).some((cols) => cols?.length);
  if (isPhotoAnswer(value)) return value.photo === "";
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

// -----------------------------------------------------------------------------
// Options across questions (carry-forward, "same as", auto-select)
// -----------------------------------------------------------------------------

/**
 * The option in `candidates` that stands for `source`: same label (case and
 * spacing ignored) first, else the same answer code. Lists in a questionnaire
 * often share labels but not codes (S5 bank list vs the Modul B list).
 */
export function matchOption(
  source: Pick<Option, "label" | "code">,
  candidates: readonly Option[],
): Option | undefined {
  const label = normalizeText(source.label);
  return (
    candidates.find((o) => normalizeText(o.label) === label) ??
    (source.code
      ? candidates.find((o) => o.code !== undefined && o.code === source.code)
      : undefined)
  );
}

/** Options picked in a choice / ranking answer (Other excluded). */
export function selectedOptions(
  question: Question,
  answer: AnswerValue | undefined,
): Option[] {
  if (!isChoiceAnswer(answer)) return [];
  const byId = new Map((question.options ?? []).map((o) => [o.id, o]));
  return answer.selected
    .map((id) => byId.get(id))
    .filter((o): o is Option => o !== undefined);
}

export type LogicContext = {
  answers: Answers;
  byKey: Map<string, Question>;
};

export function logicContext(
  definition: FormDefinition,
  answers: Answers,
): LogicContext {
  return {
    answers,
    byKey: new Map(flattenQuestions(definition).map((q) => [q.key, q])),
  };
}

/** Options offered for a question right now (carry-forward applied). */
export function effectiveOptions(
  question: Question,
  ctx: LogicContext,
): Option[] {
  const options = question.options ?? [];
  const from = question.optionsFrom;
  if (!from) return options;
  const source = ctx.byKey.get(from.questionKey);
  if (!source) return options;
  const picked = selectedOptions(source, ctx.answers[from.questionKey]);
  const matched = new Set(
    picked
      .map((o) => matchOption(o, options)?.id)
      .filter((id): id is string => id !== undefined),
  );
  return options.filter((o) =>
    from.mode === "selected" ? matched.has(o.id) : !matched.has(o.id),
  );
}

/** Rows of a grid right now (rows taken from an earlier answer when configured). */
export function effectiveRows(question: Question, ctx: LogicContext): Option[] {
  const grid = question.grid;
  if (!grid) return [];
  if (!grid.rowsFrom) return grid.rows;
  const source = ctx.byKey.get(grid.rowsFrom);
  if (!source) return [];
  const picked = new Set(
    selectedOptions(source, ctx.answers[grid.rowsFrom]).map((o) => o.id),
  );
  return (source.options ?? []).filter((o) => picked.has(o.id));
}

/** Option ids that must stay ticked (auto-selected from an earlier answer). */
export function lockedOptionIds(
  question: Question,
  ctx: LogicContext,
): string[] {
  if (!question.autoSelectFrom) return [];
  const source = ctx.byKey.get(question.autoSelectFrom);
  if (!source) return [];
  const options = question.options ?? [];
  return selectedOptions(source, ctx.answers[question.autoSelectFrom])
    .map((o) => matchOption(o, options)?.id)
    .filter((id): id is string => id !== undefined);
}

/** True when answers of two option questions share an option (label, then code). */
function sharesOption(
  a: Question,
  answerA: AnswerValue | undefined,
  b: Question,
  answerB: AnswerValue | undefined,
): boolean {
  const picked = selectedOptions(b, answerB);
  return selectedOptions(a, answerA).some(
    (o) => matchOption(o, picked) !== undefined,
  );
}

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

function equalsValue(
  question: Question,
  answer: AnswerValue,
  value: Condition["value"],
): boolean {
  if (hasOptions(question.type)) {
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
 * Unknown questions evaluate to false. Empty answers: only `is_empty`,
 * `not_equals`, `not_contains` and `not_same_as` are true.
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
      if (hasOptions(question.type))
        return equalsValue(question, answer!, condition.value);
      return normalizeText(answer).includes(normalizeText(condition.value));
    case "not_contains":
      if (empty) return true;
      if (hasOptions(question.type))
        return !equalsValue(question, answer!, condition.value);
      return !normalizeText(answer).includes(normalizeText(condition.value));
    case "same_as":
    case "not_same_as": {
      const other = questionsByKey.get(String(condition.value ?? ""));
      const same =
        !empty &&
        !!other &&
        sharesOption(question, answer, other, answers[String(condition.value)]);
      return condition.operator === "same_as" ? same : !same;
    }
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

// -----------------------------------------------------------------------------
// Flow: show-if, jumps, screen-outs
// -----------------------------------------------------------------------------

export type Termination = {
  questionKey: string;
  /** Question code (S1) when set. */
  code?: string;
  reason?: string;
};

export type Flow = {
  visible: Question[];
  /** Set when a rule ended the interview (screen-out). */
  terminated?: Termination;
};

function ruleApplies(
  rule: Rule,
  answers: Answers,
  byKey: Map<string, Question>,
) {
  const hasWhen = (rule.when?.conditions.length ?? 0) > 0;
  if (!hasWhen) return rule.action === "jump";
  return evaluateConditionGroup(rule.when, answers, byKey);
}

/**
 * Walks the form in order. A question hidden by its condition, or skipped by
 * a jump, contributes an EMPTY answer to later conditions, so chains of
 * hidden questions collapse correctly. A terminating rule ends the walk.
 */
export function computeFlow(
  definition: FormDefinition,
  answers: Answers,
): Flow {
  const byKey = new Map(flattenQuestions(definition).map((q) => [q.key, q]));
  const effective: Answers = {};
  const visible: Question[] = [];
  let skipTo: string | null = null;

  for (const section of definition.sections) {
    if (skipTo === section.id) skipTo = null;
    for (const question of section.questions) {
      if (skipTo !== null) {
        if (skipTo !== question.key) continue;
        skipTo = null;
      }
      if (!evaluateConditionGroup(question.showIf, effective, byKey)) continue;
      visible.push(question);
      effective[question.key] = answers[question.key];
      for (const rule of question.rules ?? []) {
        if (!ruleApplies(rule, effective, byKey)) continue;
        if (rule.action === "terminate") {
          return {
            visible,
            terminated: {
              questionKey: question.key,
              ...(question.code ? { code: question.code } : {}),
              ...(rule.reason ? { reason: rule.reason } : {}),
            },
          };
        }
        if (rule.target) {
          skipTo = rule.target;
          break;
        }
      }
    }
  }
  return { visible };
}

/** Questions visible for the given answers, in form order. */
export function getVisibleQuestions(
  definition: FormDefinition,
  answers: Answers,
): Question[] {
  return computeFlow(definition, answers).visible;
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

// -----------------------------------------------------------------------------
// Piping: "[S5]" in a title shows the answer of the question coded S5
// -----------------------------------------------------------------------------

/** Text of an answer for display (labels for options, "Other" text for Other). */
export function answerDisplay(
  question: Question,
  answer: AnswerValue | undefined,
): string | null {
  if (isAnswerEmpty(answer)) return null;
  if (isChoiceAnswer(answer)) {
    const byId = new Map((question.options ?? []).map((o) => [o.id, o.label]));
    return answer.selected
      .map((id) =>
        id === OTHER_OPTION_ID
          ? (answer.otherText ?? "")
          : (byId.get(id) ?? id),
      )
      .filter(Boolean)
      .join(", ");
  }
  if (typeof answer === "string" || typeof answer === "number")
    return String(answer);
  return null;
}

const PIPE = /\[([A-Za-z0-9_.-]{1,20})\]/g;

/**
 * Replaces "[CODE]" with the answer of the question with that code. Unknown
 * codes and unanswered questions keep the token (e.g. "[kartu skala]").
 */
export function pipeText(
  text: string,
  definition: FormDefinition,
  answers: Answers,
): string {
  if (!text.includes("[")) return text;
  const byCode = new Map<string, Question>();
  for (const q of flattenQuestions(definition))
    if (q.code) byCode.set(q.code.toUpperCase(), q);
  return text.replace(PIPE, (token, code: string) => {
    const question = byCode.get(code.toUpperCase());
    if (!question) return token;
    return answerDisplay(question, answers[question.key]) ?? token;
  });
}

// -----------------------------------------------------------------------------
// Seeded random order (options, grid rows)
// -----------------------------------------------------------------------------

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Options that keep their place at the end ("None", 97/98/99 codes). */
function isAnchored(option: Option): boolean {
  if (option.exclusive) return true;
  const code = Number(option.code);
  return Number.isFinite(code) && code >= 97;
}

/**
 * Deterministic shuffle for one interview (`seed`) and one question. The same
 * `group` (a question key) gives the same order, so G2 follows G1.
 */
export function seededOrder<T extends Option>(
  items: readonly T[],
  seed: string,
  group: string,
): T[] {
  const free = items.filter((o) => !isAnchored(o));
  const anchored = items.filter(isAnchored);
  // Sort by id first: the order must not depend on how the list was filtered.
  const random = mulberry32(hashString(`${seed}:${group}`));
  const keyed = [...free]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({ item, r: random() }));
  keyed.sort((a, b) => a.r - b.r);
  return [...keyed.map((k) => k.item), ...anchored];
}

/** Display order of a question's options for this interview. */
export function displayOptions(
  question: Question,
  options: Option[],
  seed: string | undefined,
): Option[] {
  if (!seed || !question.randomizeOptions) return options;
  return seededOrder(options, seed, question.orderLike ?? question.key);
}

/** Display order of a grid's rows for this interview. */
export function displayRows(
  question: Question,
  rows: Option[],
  seed: string | undefined,
): Option[] {
  if (!seed || !question.grid?.randomizeRows) return rows;
  return seededOrder(rows, seed, question.orderLike ?? question.key);
}
