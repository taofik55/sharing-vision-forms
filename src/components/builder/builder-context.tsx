"use client";

import { createContext, useContext } from "react";
import type { NewQuestionLabels } from "@/lib/forms/operations";
import type {
  DefinitionProblem,
  FormDefinition,
  QuestionType,
} from "@/lib/forms/schema";

export type Selection = { kind: "question" | "section"; id: string } | null;

export type BuilderContextValue = {
  definition: FormDefinition;
  /** Commit a new definition. Same coalesceKey within 1s = one undo step. */
  apply: (definition: FormDefinition, coalesceKey?: string) => void;
  selection: Selection;
  select: (selection: Selection) => void;
  problems: DefinitionProblem[];
  labels: NewQuestionLabels;
  sectionTitle: (n: number) => string;
  addQuestionOfType: (
    type: QuestionType,
    target?: { sectionId: string; index: number },
  ) => void;
};

export const BuilderContext = createContext<BuilderContextValue | null>(null);

export function useBuilder(): BuilderContextValue {
  const ctx = useContext(BuilderContext);
  if (!ctx) throw new Error("useBuilder must be used inside <Builder>");
  return ctx;
}

/** Scrolls the canvas card of a question/section into view and focuses it. */
export function revealItem(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`item-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  });
}
