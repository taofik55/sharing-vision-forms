/**
 * Analysis questions: the flat view of a definition that dashboards, the
 * chart builder and exports read. Mirrors `public._analysis_questions` in SQL
 * (supabase/migrations/*_capi_toolkit.sql) — keep both in step.
 *
 * - grid: one single / multiple choice question per row,
 *   key `<grid key>__<row id>`, options = the grid's columns;
 * - ranking: the question itself as checkboxes ("mentioned") plus one single
 *   choice question per position, key `<key>__r<n>`;
 * - everything else: unchanged.
 */
import {
  flattenQuestions,
  type FormDefinition,
  type Option,
  type Question,
} from "./schema";

export const ANALYSIS_SEPARATOR = "__";

export function gridRowKey(gridKey: string, rowId: string): string {
  return `${gridKey}${ANALYSIS_SEPARATOR}${rowId}`;
}

export function rankKey(key: string, position: number): string {
  return `${key}${ANALYSIS_SEPARATOR}r${position}`;
}

/** Rows a grid can have (all source options when rows are carried over). */
export function possibleRows(
  question: Question,
  byKey: Map<string, Question>,
): Option[] {
  const grid = question.grid;
  if (!grid) return [];
  if (grid.rowsFrom) return byKey.get(grid.rowsFrom)?.options ?? [];
  return grid.rows;
}

function joinCode(
  code: string | undefined,
  suffix: string,
): string | undefined {
  return code ? `${code}.${suffix}` : undefined;
}

/** The flat analysis questions of one definition question. */
export function expandQuestion(
  question: Question,
  byKey: Map<string, Question>,
): Question[] {
  const base = {
    required: question.required,
    options: question.options ?? [],
  };
  if (question.type === "grid") {
    return possibleRows(question, byKey).map((row, i) => ({
      ...base,
      id: gridRowKey(question.id, row.id),
      key: gridRowKey(question.key, row.id),
      type: question.grid?.multiple ? "checkboxes" : "multiple_choice",
      title: `${question.title} — ${row.label}`,
      code: joinCode(question.code, row.code || String(i + 1)),
    }));
  }
  if (question.type === "ranking") {
    const max = question.ranking?.max ?? 1;
    const mentioned: Question = {
      ...base,
      id: question.id,
      key: question.key,
      type: "checkboxes",
      title: question.title,
      code: question.code,
      allowOther: question.allowOther,
    };
    const positions = Array.from({ length: max }, (_, i) => ({
      ...base,
      id: rankKey(question.id, i + 1),
      key: rankKey(question.key, i + 1),
      type: "multiple_choice" as const,
      title: `${question.title} (#${i + 1})`,
      code: question.code ? `${question.code}_${i + 1}` : undefined,
      allowOther: question.allowOther,
    }));
    return [mentioned, ...positions];
  }
  return [question];
}

/** All analysis questions of a definition, in form order. */
export function analysisQuestions(definition: FormDefinition): Question[] {
  const all = flattenQuestions(definition);
  const byKey = new Map(all.map((q) => [q.key, q]));
  return all.flatMap((q) => expandQuestion(q, byKey));
}
