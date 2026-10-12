"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Copy,
  EllipsisVertical,
  GitBranch,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addSection,
  createSection,
  dependentsOf,
  duplicateQuestion,
  moveSection,
  removeQuestion,
  removeSection,
} from "@/lib/forms/operations";
import { isChoiceType, type Question, type Section } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { revealItem, useBuilder } from "./builder-context";
import { QuestionTypeIcon } from "./question-type-icon";

export const SECTION_DROP_PREFIX = "section:";

export function Canvas() {
  const t = useTranslations("builder");
  const { definition, apply, select, sectionTitle } = useBuilder();

  return (
    <div className="flex flex-col gap-6">
      {definition.sections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          index={index}
          total={definition.sections.length}
        />
      ))}
      <Button
        variant="outline"
        className="self-center"
        onClick={() => {
          const section = createSection(
            sectionTitle(definition.sections.length + 1),
          );
          apply(addSection(definition, section));
          select({ kind: "section", id: section.id });
          revealItem(section.id);
        }}
        data-testid="add-section"
      >
        <Plus aria-hidden />
        {t("addSection")}
      </Button>
    </div>
  );
}

function SectionCard({
  section,
  index,
  total,
}: {
  section: Section;
  index: number;
  total: number;
}) {
  const t = useTranslations("builder");
  const { definition, apply, selection, select, problems } = useBuilder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `${SECTION_DROP_PREFIX}${section.id}`,
    data: { kind: "section", sectionId: section.id },
    // Only empty sections are drop targets themselves; otherwise questions are,
    // which keeps keyboard dragging moving from question to question.
    disabled: section.questions.length > 0,
  });
  const selected = selection?.kind === "section" && selection.id === section.id;
  const hasProblem = problems.some(
    (p) => p.sectionId === section.id && !p.questionId,
  );

  function remove() {
    apply(removeSection(definition, section.id));
    select(null);
    setConfirmDelete(false);
  }

  return (
    <section
      aria-label={t("section.label", { number: index + 1, total })}
      className={cn(
        "rounded-xl border bg-muted/30",
        selected && "ring-2 ring-primary",
      )}
      data-testid={`section-${index}`}
    >
      <div className="flex items-start gap-2 border-b p-3">
        <button
          id={`item-${section.id}`}
          type="button"
          className="flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-accent/50"
          onClick={() => select({ kind: "section", id: section.id })}
          aria-label={t("section.edit")}
        >
          <span className="text-xs text-muted-foreground">
            {t("section.label", { number: index + 1, total })}
          </span>
          <span className="flex items-center gap-2 font-semibold">
            {section.title || (
              <span className="text-muted-foreground italic">
                {t("section.titlePlaceholder")}
              </span>
            )}
            {hasProblem && (
              <CircleAlert className="size-4 text-destructive" aria-hidden />
            )}
          </span>
          {section.description && (
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {section.description}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            disabled={index === 0}
            aria-label={t("section.moveUp")}
            onClick={() =>
              apply(moveSection(definition, section.id, index - 1))
            }
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={index === total - 1}
            aria-label={t("section.moveDown")}
            onClick={() =>
              apply(moveSection(definition, section.id, index + 1))
            }
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={total <= 1}
            aria-label={t("section.delete")}
            onClick={() =>
              section.questions.length ? setConfirmDelete(true) : remove()
            }
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <SortableContext
        items={section.questions.map((q) => q.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol
          ref={setNodeRef}
          className={cn(
            "flex min-h-20 flex-col gap-2 p-3 transition-colors",
            isOver && "bg-primary/5",
          )}
          data-testid={`section-drop-${index}`}
        >
          {section.questions.map((q) => (
            <SortableQuestionCard key={q.id} question={q} />
          ))}
          {section.questions.length === 0 && (
            <li className="flex min-h-14 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
              {t("emptySection")}
            </li>
          )}
        </ol>
      </SortableContext>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("section.deleteTitle")}
        description={t("section.deleteDescription", {
          count: section.questions.length,
        })}
        confirmLabel={t("section.delete")}
        destructive
        onConfirm={remove}
      />
    </section>
  );
}

function SortableQuestionCard({ question }: { question: Question }) {
  const t = useTranslations("builder");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: question.id,
    data: { kind: "question" },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <QuestionCard
        question={question}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t("dragHandle", {
              title: question.title || t("untitledQuestion"),
            })}
            data-testid="drag-handle"
            className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        }
      />
    </li>
  );
}

export function QuestionCard({
  question,
  handle,
}: {
  question: Question;
  handle?: React.ReactNode;
}) {
  const t = useTranslations();
  const { definition, apply, selection, select, problems } = useBuilder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected =
    selection?.kind === "question" && selection.id === question.id;
  const hasProblem = problems.some((p) => p.questionId === question.id);
  const dependents = dependentsOf(definition, question.key).length;
  const title = question.title || t("builder.untitledQuestion");

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-card p-3 shadow-xs",
        selected && "ring-2 ring-primary",
        hasProblem && "border-destructive",
      )}
      data-testid="question-card"
      data-question-id={question.id}
    >
      {handle && <div className="pt-0.5">{handle}</div>}
      <button
        id={`item-${question.id}`}
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left focus-visible:outline-none"
        onClick={() => select({ kind: "question", id: question.id })}
        aria-label={t("builder.selectQuestion", { title })}
        aria-pressed={selected}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <QuestionTypeIcon type={question.type} className="size-3.5" />
          {t(`questionTypes.${question.type}`)}
        </span>
        <span className="font-medium break-words">
          {title}
          {question.required && (
            <span
              className="ml-1 text-destructive"
              title={t("builder.requiredMark")}
            >
              *
            </span>
          )}
        </span>
        {isChoiceType(question.type) &&
          question.options &&
          question.options.length > 0 && (
            <span className="line-clamp-1 text-xs text-muted-foreground">
              {question.options.map((o) => o.label).join(" · ")}
            </span>
          )}
        <span className="flex flex-wrap gap-1">
          {question.showIf && (
            <Badge variant="secondary" className="gap-1">
              <GitBranch className="size-3" aria-hidden />
              {t("builder.hasLogic")}
            </Badge>
          )}
          {hasProblem && (
            <Badge variant="destructive" className="gap-1">
              <CircleAlert className="size-3" aria-hidden />
              {t("builder.problems.title")}
            </Badge>
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("builder.question.moreActions")}
          >
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              const { definition: next, question: copy } = duplicateQuestion(
                definition,
                question.id,
              );
              apply(next);
              if (copy) {
                select({ kind: "question", id: copy.id });
                revealItem(copy.id);
              }
            }}
          >
            <Copy aria-hidden />
            {t("builder.question.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            {t("builder.question.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("builder.question.deleteTitle")}
        description={
          <>
            {t("builder.question.deleteDescription")}
            {dependents > 0 && (
              <> {t("builder.question.dependents", { count: dependents })}</>
            )}
          </>
        }
        confirmLabel={t("builder.question.delete")}
        destructive
        onConfirm={() => {
          apply(removeQuestion(definition, question.id));
          if (selected) select(null);
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}
