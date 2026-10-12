"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { findQuestion } from "@/lib/forms/operations";
import type { DefinitionProblem } from "@/lib/forms/schema";
import { revealItem, useBuilder } from "./builder-context";

type ProblemsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Pre-publish validation: every problem, click to jump to the item. */
export function ProblemsPanel({ open, onOpenChange }: ProblemsPanelProps) {
  const t = useTranslations("builder");
  const tp = useTranslations("problems");
  const { problems, definition, select } = useBuilder();

  function itemLabel(problem: DefinitionProblem): string {
    if (problem.questionId) {
      const loc = findQuestion(definition, problem.questionId);
      return loc?.question.title || t("untitledQuestion");
    }
    if (problem.sectionId) {
      const index = definition.sections.findIndex(
        (s) => s.id === problem.sectionId,
      );
      return (
        definition.sections[index]?.title ||
        t("sectionTitle", { number: index + 1 })
      );
    }
    return t("problems.formLevel");
  }

  function jump(problem: DefinitionProblem) {
    const id = problem.questionId ?? problem.sectionId;
    if (!id) return;
    select({ kind: problem.questionId ? "question" : "section", id });
    revealItem(id);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="problems-button">
          {problems.length ? (
            <CircleAlert className="text-destructive" aria-hidden />
          ) : (
            <CircleCheck className="text-emerald-600" aria-hidden />
          )}
          {problems.length
            ? t("problems.count", { count: problems.length })
            : t("problems.title")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">
          {t("problems.title")}
        </div>
        {problems.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("problems.none")}
          </p>
        ) : (
          <ul
            className="max-h-80 overflow-auto py-1"
            data-testid="problems-list"
          >
            {problems.map((problem, i) => (
              <li
                key={`${problem.code}-${problem.questionId ?? problem.sectionId ?? i}-${i}`}
              >
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left hover:bg-accent"
                  onClick={() => jump(problem)}
                  aria-label={`${t("problems.jump")}: ${itemLabel(problem)}`}
                >
                  <span className="line-clamp-1 text-sm font-medium">
                    {itemLabel(problem)}
                  </span>
                  <span className="text-xs text-destructive">
                    {tp(problem.code)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
