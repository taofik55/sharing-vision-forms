/**
 * Immutable mutations of a FormDefinition used by the builder (and by
 * duplication / templates). Pure functions, unit-tested.
 */
import { customAlphabet } from "nanoid";
import {
  hasOptions,
  isChoiceType,
  supportsPlaceholder,
  type ConditionGroup,
  type FormDefinition,
  type Option,
  type Question,
  type QuestionType,
  type Section,
  type ValidationRules,
} from "./schema";

// URL-safe, matches the schema id pattern.
const nano = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  12,
);
export function newId(): string {
  return nano();
}

export type NewQuestionLabels = {
  title: string;
  /** Label for the n-th default option (1-based). */
  option: (n: number) => string;
  /** Label for the n-th default grid row (1-based). */
  row?: (n: number) => string;
};

export function createQuestion(
  type: QuestionType,
  labels: NewQuestionLabels,
): Question {
  const base: Question = {
    id: newId(),
    key: newId(),
    type,
    title: labels.title,
    required: false,
  };
  return applyTypeDefaults(base, labels);
}

function applyTypeDefaults(
  question: Question,
  labels: Pick<NewQuestionLabels, "option" | "row">,
): Question {
  const q = { ...question };
  if (hasOptions(q.type)) {
    if (!q.options || q.options.length === 0) {
      const count = q.type === "grid" || q.type === "ranking" ? 3 : 2;
      q.options = Array.from({ length: count }, (_, i) => ({
        id: newId(),
        label: labels.option(i + 1),
      }));
    }
  } else {
    delete q.options;
    delete q.allowOther;
    delete q.randomizeOptions;
    delete q.optionsFrom;
  }
  if (q.type === "grid") {
    delete q.allowOther;
    q.grid ??= {
      multiple: false,
      rows: [1, 2].map((n) => ({
        id: newId(),
        label: (labels.row ?? labels.option)(n),
      })),
    };
  } else delete q.grid;
  if (q.type === "ranking")
    q.ranking ??= { max: Math.min(3, q.options?.length ?? 3) };
  else delete q.ranking;
  if (q.type !== "checkboxes") delete q.autoSelectFrom;
  if (!isChoiceType(q.type)) delete q.notSameAs;
  if (!hasOptions(q.type)) delete q.orderLike;
  if (q.type === "linear_scale") q.scale ??= { min: 1, max: 5 };
  else delete q.scale;
  if (q.type === "rating") q.rating ??= { max: 5 };
  else delete q.rating;
  if (!supportsPlaceholder(q.type)) delete q.placeholder;
  return q;
}

const VALIDATION_KEYS_BY_TYPE: Partial<
  Record<QuestionType, (keyof ValidationRules)[]>
> = {
  short_text: ["minLength", "maxLength", "pattern"],
  paragraph: ["minLength", "maxLength"],
  number: ["min", "max", "integerOnly"],
  date: ["minDate", "maxDate"],
  checkboxes: ["min", "max"],
};

export function validationKeysFor(
  type: QuestionType,
): (keyof ValidationRules)[] {
  return VALIDATION_KEYS_BY_TYPE[type] ?? [];
}

/** Keeps only the validation rules that apply to the question type. */
export function pruneValidation(
  type: QuestionType,
  rules?: ValidationRules,
): ValidationRules | undefined {
  if (!rules) return undefined;
  const allowed = validationKeysFor(type);
  const next: ValidationRules = {};
  for (const key of allowed) {
    if (rules[key] !== undefined && rules[key] !== "") {
      (next as Record<string, unknown>)[key] = rules[key];
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/**
 * Changes the type, keeping compatible settings (title, description,
 * required, logic, options between choice types). `lostOptions` tells the
 * UI to warn before applying.
 */
export function changeQuestionType(
  question: Question,
  type: QuestionType,
  labels: Pick<NewQuestionLabels, "option" | "row">,
): { question: Question; lostOptions: boolean } {
  const lostOptions =
    hasOptions(question.type) &&
    !hasOptions(type) &&
    (question.options?.length ?? 0) > 0;
  const next: Question = { ...question, type };
  const validation = pruneValidation(type, question.validation);
  if (validation) next.validation = validation;
  else delete next.validation;
  return { question: applyTypeDefaults(next, labels), lostOptions };
}

export type QuestionLocation = {
  section: Section;
  sectionIndex: number;
  question: Question;
  index: number;
};

export function findQuestion(
  def: FormDefinition,
  questionId: string,
): QuestionLocation | null {
  for (
    let sectionIndex = 0;
    sectionIndex < def.sections.length;
    sectionIndex++
  ) {
    const section = def.sections[sectionIndex];
    const index = section.questions.findIndex((q) => q.id === questionId);
    if (index >= 0)
      return {
        section,
        sectionIndex,
        question: section.questions[index],
        index,
      };
  }
  return null;
}

function mapSection(
  def: FormDefinition,
  sectionId: string,
  fn: (s: Section) => Section,
): FormDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
  };
}

export function addQuestion(
  def: FormDefinition,
  sectionId: string,
  question: Question,
  index?: number,
): FormDefinition {
  return mapSection(def, sectionId, (s) => {
    const questions = [...s.questions];
    const at =
      index === undefined
        ? questions.length
        : Math.max(0, Math.min(index, questions.length));
    questions.splice(at, 0, question);
    return { ...s, questions };
  });
}

export function updateQuestion(
  def: FormDefinition,
  questionId: string,
  patch: Partial<Omit<Question, "id" | "key">>,
): FormDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => {
        if (q.id !== questionId) return q;
        const next = { ...q, ...patch } as Question;
        // Drop keys explicitly set to undefined so JSON stays clean.
        for (const k of Object.keys(next) as (keyof Question)[]) {
          if (next[k] === undefined) delete next[k];
        }
        return next;
      }),
    })),
  };
}

export function replaceQuestion(
  def: FormDefinition,
  question: Question,
): FormDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => (q.id === question.id ? question : q)),
    })),
  };
}

export function removeQuestion(
  def: FormDefinition,
  questionId: string,
): FormDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.filter((q) => q.id !== questionId),
    })),
  };
}

/** Copy with a NEW id and key, inserted right after the original. */
export function duplicateQuestion(
  def: FormDefinition,
  questionId: string,
): { definition: FormDefinition; question: Question | null } {
  const loc = findQuestion(def, questionId);
  if (!loc) return { definition: def, question: null };
  const copy: Question = structuredClone(loc.question);
  copy.id = newId();
  copy.key = newId();
  return {
    definition: addQuestion(def, loc.section.id, copy, loc.index + 1),
    question: copy,
  };
}

export function moveQuestion(
  def: FormDefinition,
  questionId: string,
  toSectionId: string,
  toIndex: number,
): FormDefinition {
  const loc = findQuestion(def, questionId);
  if (!loc || !def.sections.some((s) => s.id === toSectionId)) return def;
  const without = removeQuestion(def, questionId);
  return addQuestion(without, toSectionId, loc.question, toIndex);
}

export function createSection(title: string): Section {
  return { id: newId(), title, questions: [] };
}

export function addSection(
  def: FormDefinition,
  section: Section,
  index?: number,
): FormDefinition {
  const sections = [...def.sections];
  sections.splice(index ?? sections.length, 0, section);
  return { ...def, sections };
}

export function updateSection(
  def: FormDefinition,
  sectionId: string,
  patch: Partial<Pick<Section, "title" | "description">>,
): FormDefinition {
  return mapSection(def, sectionId, (s) => {
    const next = { ...s, ...patch };
    if (next.description === undefined || next.description === "")
      delete next.description;
    return next;
  });
}

/** Removes a section. The last remaining section cannot be removed. */
export function removeSection(
  def: FormDefinition,
  sectionId: string,
): FormDefinition {
  if (def.sections.length <= 1) return def;
  return { ...def, sections: def.sections.filter((s) => s.id !== sectionId) };
}

export function moveSection(
  def: FormDefinition,
  sectionId: string,
  toIndex: number,
): FormDefinition {
  const from = def.sections.findIndex((s) => s.id === sectionId);
  if (from < 0) return def;
  const to = Math.max(0, Math.min(toIndex, def.sections.length - 1));
  const sections = [...def.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(to, 0, moved);
  return { ...def, sections };
}

export function moveOption(
  options: Option[],
  from: number,
  to: number,
): Option[] {
  const next = [...options];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/** "1 Pemilik", "97 = Tidak tahu", "· 2 Pengelola": answer code + label. */
const CODED_LINE = /^[·•\-*]?\s*(\d{1,3})\s*(?:[.):=-]\s*|\s+)(.+)$/;

/**
 * "a\n\n b \nc" -> options for each non-empty line (trimmed, deduplicated).
 * A leading number becomes the option's answer code ("1 Pemilik").
 */
export function optionsFromLines(
  text: string,
  existing: Option[] = [],
): Option[] {
  const seen = new Set(existing.map((o) => o.label.trim().toLowerCase()));
  const added: Option[] = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    const coded = CODED_LINE.exec(raw);
    const label = (coded ? coded[2] : raw).trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    added.push({ id: newId(), label, ...(coded ? { code: coded[1] } : {}) });
  }
  return [...existing, ...added];
}

/**
 * Deep copy with NEW section ids, question ids and question keys. Condition
 * references are remapped to the new keys. Option ids are kept (they are
 * scoped to their question).
 */
export function cloneDefinitionWithNewKeys(
  def: FormDefinition,
): FormDefinition {
  const keyMap = new Map<string, string>();
  const sectionMap = new Map<string, string>();
  for (const s of def.sections) {
    sectionMap.set(s.id, newId());
    for (const q of s.questions) keyMap.set(q.key, newId());
  }
  const key = (k: string) => keyMap.get(k) ?? k;
  const group = (g: ConditionGroup): ConditionGroup => ({
    ...g,
    conditions: g.conditions.map((c) => ({
      ...c,
      questionKey: key(c.questionKey),
      ...(c.operator === "same_as" || c.operator === "not_same_as"
        ? { value: key(String(c.value ?? "")) }
        : {}),
    })),
  });

  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...structuredClone(s),
      id: sectionMap.get(s.id)!,
      questions: s.questions.map((q) => {
        const copy: Question = structuredClone(q);
        copy.id = newId();
        copy.key = key(q.key);
        if (copy.showIf) copy.showIf = group(copy.showIf);
        if (copy.rules)
          copy.rules = copy.rules.map((r) => ({
            ...r,
            ...(r.when ? { when: group(r.when) } : {}),
            ...(r.target
              ? { target: sectionMap.get(r.target) ?? key(r.target) }
              : {}),
          }));
        if (copy.optionsFrom)
          copy.optionsFrom = {
            ...copy.optionsFrom,
            questionKey: key(copy.optionsFrom.questionKey),
          };
        if (copy.autoSelectFrom) copy.autoSelectFrom = key(copy.autoSelectFrom);
        if (copy.notSameAs) copy.notSameAs = key(copy.notSameAs);
        if (copy.orderLike) copy.orderLike = key(copy.orderLike);
        if (copy.grid?.rowsFrom)
          copy.grid = { ...copy.grid, rowsFrom: key(copy.grid.rowsFrom) };
        return copy;
      }),
    })),
  };
}

/** Every question key a question refers to (logic, rules, carried-over options). */
export function referencedKeys(q: Question): string[] {
  const fromGroup = (g?: ConditionGroup) =>
    (g?.conditions ?? []).flatMap((c) =>
      c.operator === "same_as" || c.operator === "not_same_as"
        ? [c.questionKey, String(c.value ?? "")]
        : [c.questionKey],
    );
  return [
    ...fromGroup(q.showIf),
    ...(q.rules ?? []).flatMap((r) => [
      ...fromGroup(r.when),
      ...(r.target ? [r.target] : []),
    ]),
    ...(q.optionsFrom ? [q.optionsFrom.questionKey] : []),
    ...(q.autoSelectFrom ? [q.autoSelectFrom] : []),
    ...(q.notSameAs ? [q.notSameAs] : []),
    ...(q.orderLike ? [q.orderLike] : []),
    ...(q.grid?.rowsFrom ? [q.grid.rowsFrom] : []),
  ];
}

/** Questions (by key) that refer to the given key. */
export function dependentsOf(def: FormDefinition, key: string): Question[] {
  return def.sections.flatMap((s) =>
    s.questions.filter((q) => q.key !== key && referencedKeys(q).includes(key)),
  );
}

export function emptyDefinition(
  sectionTitle: string,
  question: Question,
): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [{ id: newId(), title: sectionTitle, questions: [question] }],
  };
}
