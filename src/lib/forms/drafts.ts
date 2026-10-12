/**
 * Respondent drafts (client side). A draft is kept in localStorage under
 * fp:draft:<formId> and mirrored to the server (without the identifier).
 */
import type { Answers } from "./logic";
import { flattenQuestions, type FormDefinition } from "./schema";
import { questionValueSchema } from "./validation";

export type LocalDraft = {
  versionId: string;
  answers: Answers;
  sectionId: string | null;
  identifier: { email: string; phone: string };
  /** "identifier" until the identifier step is passed. */
  step: "identifier" | "form";
  startedAt: number;
  draftToken: string;
  /** Reused across retries so a resubmit is idempotent. */
  submissionToken: string;
  updatedAt: number;
};

export function draftStorageKey(formId: string): string {
  return `fp:draft:${formId}`;
}

export function hasDraftContent(draft: LocalDraft): boolean {
  return (
    Object.values(draft.answers).some((v) => v !== undefined && v !== "") ||
    Boolean(draft.identifier.email || draft.identifier.phone)
  );
}

/**
 * Maps answers from an older version onto the current definition by
 * question_key. Answers for removed questions, or that no longer fit the
 * question (e.g. changed type or removed option), are dropped.
 */
export function migrateDraftAnswers(
  answers: Answers,
  definition: FormDefinition,
): { answers: Answers; dropped: string[] } {
  const byKey = new Map(flattenQuestions(definition).map((q) => [q.key, q]));
  const kept: Answers = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined) continue;
    const question = byKey.get(key);
    if (question && questionValueSchema(question).safeParse(value).success)
      kept[key] = value;
    else dropped.push(key);
  }
  return { answers: kept, dropped };
}

export function readLocalDraft(formId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(formId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as LocalDraft;
    return draft &&
      typeof draft === "object" &&
      draft.answers &&
      draft.draftToken
      ? draft
      : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(
  formId: string,
  draft: LocalDraft | null,
): void {
  try {
    if (draft)
      window.localStorage.setItem(
        draftStorageKey(formId),
        JSON.stringify(draft),
      );
    else window.localStorage.removeItem(draftStorageKey(formId));
  } catch {
    // Storage full or blocked: the server draft still exists.
  }
}
