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
  CalendarDays,
  ChevronsUpDown,
  CircleAlert,
  CircleDot,
  Copy,
  EllipsisVertical,
  GitBranch,
  GripVertical,
  ListFilter,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addSection,
  changeQuestionType,
  createSection,
  dependentsOf,
  duplicateQuestion,
  moveSection,
  removeQuestion,
  removeSection,
  replaceQuestion,
  updateQuestion,
} from "@/lib/forms/operations";
import {
  LIMITS,
  isChoiceType,
  supportsPlaceholder,
  type Question,
  type QuestionType,
  type Section,
} from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { revealItem, useBuilder } from "./builder-context";
import { RADIO_ON } from "./choice-style";
import { OptionsEditor } from "./options-editor";
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
  overlay = false,
}: {
  question: Question;
  handle?: React.ReactNode;
  /** Drag preview: always the compact read-only view. */
  overlay?: boolean;
}) {
  const t = useTranslations();
  const { definition, apply, selection, select, problems } = useBuilder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected =
    selection?.kind === "question" && selection.id === question.id;
  const editing = selected && !overlay;
  const hasProblem = problems.some((p) => p.questionId === question.id);
  const dependents = dependentsOf(definition, question.key).length;
  const title = question.title || t("builder.untitledQuestion");

  const badges = (
    <span className="flex flex-wrap gap-1 empty:hidden">
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
  );

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-card p-3 shadow-xs",
        selected && "ring-2 ring-primary",
        hasProblem && "border-destructive",
      )}
      data-testid="question-card"
      data-question-id={question.id}
      data-editing={editing || undefined}
    >
      {handle && <div className="pt-0.5">{handle}</div>}
      {editing ? (
        <InlineEditor question={question} badges={badges} />
      ) : (
        <button
          id={overlay ? undefined : `item-${question.id}`}
          type="button"
          className="flex min-w-0 flex-1 flex-col items-start gap-2 text-left focus-visible:outline-none"
          onClick={() => {
            select({ kind: "question", id: question.id });
            revealItem(question.id, "focus");
          }}
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
          {question.description && (
            <span className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
              {question.description}
            </span>
          )}
          <FieldPreview question={question} />
          {badges}
        </button>
      )}
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

/** Many options read better in a searchable dropdown than as a long radio list. */
const RADIO_RECOMMENDED_MAX = 5;

/**
 * The selected question, edited in place: title, description, placeholder,
 * options, radio / dropdown display and "required". Everything else (type,
 * section, validation, logic, scale) stays in the panel on the right.
 */
function InlineEditor({
  question,
  badges,
}: {
  question: Question;
  badges: React.ReactNode;
}) {
  const t = useTranslations();
  const { definition, apply, labels } = useBuilder();
  const update = (patch: Partial<Question>, key?: string) =>
    apply(
      updateQuestion(definition, question.id, patch),
      key ? `${question.id}:${key}` : undefined,
    );
  const single =
    question.type === "multiple_choice" || question.type === "dropdown";
  const optionCount = question.options?.length ?? 0;
  const defaultPlaceholder =
    question.type === "dropdown"
      ? t("renderer.chooseOption")
      : t("renderer.textPlaceholder");

  return (
    <div
      id={`item-${question.id}`}
      tabIndex={-1}
      className="flex min-w-0 flex-1 flex-col gap-3 focus-visible:outline-none"
      data-testid="question-editor"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <QuestionTypeIcon type={question.type} className="size-3.5" />
          {t(`questionTypes.${question.type}`)}
        </span>
        {badges}
      </div>

      <Textarea
        id="q-title"
        data-title-input={question.id}
        aria-label={t("builder.inspector.questionTitle")}
        placeholder={t("builder.inspector.questionTitle")}
        rows={1}
        value={question.title}
        maxLength={LIMITS.title}
        onChange={(e) => update({ title: e.target.value }, "title")}
        className="min-h-10 resize-none text-base font-medium md:text-base"
      />
      <Textarea
        id="q-description"
        aria-label={t("builder.inspector.descriptionLabel")}
        placeholder={t("builder.card.descriptionPlaceholder")}
        rows={1}
        value={question.description ?? ""}
        maxLength={LIMITS.description}
        onChange={(e) =>
          update({ description: e.target.value || undefined }, "description")
        }
        className="min-h-9 resize-none text-sm"
      />

      {supportsPlaceholder(question.type) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="q-placeholder" className="text-xs">
            {t("builder.card.placeholder")}
          </Label>
          <Input
            id="q-placeholder"
            value={question.placeholder ?? ""}
            maxLength={LIMITS.placeholder}
            placeholder={defaultPlaceholder}
            onChange={(e) =>
              update(
                { placeholder: e.target.value || undefined },
                "placeholder",
              )
            }
            className="h-9 max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            {t("builder.card.placeholderHint", { default: defaultPlaceholder })}
          </p>
        </div>
      )}

      {single && (
        <div className="flex flex-col gap-1.5">
          <span id={`display-${question.id}`} className="text-xs font-medium">
            {t("builder.card.display")}
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={question.type}
            onValueChange={(v) => {
              if (!v || v === question.type) return;
              apply(
                replaceQuestion(
                  definition,
                  changeQuestionType(question, v as QuestionType, labels)
                    .question,
                ),
              );
            }}
            aria-labelledby={`display-${question.id}`}
            className="w-full max-w-md"
            data-testid="choice-display"
          >
            <ToggleGroupItem
              value="multiple_choice"
              className={cn("flex-1 gap-1.5", RADIO_ON)}
            >
              <CircleDot aria-hidden />
              {t("builder.card.displayRadio")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="dropdown"
              className={cn("flex-1 gap-1.5", RADIO_ON)}
            >
              <ListFilter aria-hidden />
              {t("builder.card.displayDropdown")}
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {question.type === "multiple_choice" &&
            optionCount > RADIO_RECOMMENDED_MAX
              ? t("builder.card.suggestDropdown", { count: optionCount })
              : question.type === "dropdown" &&
                  optionCount <= RADIO_RECOMMENDED_MAX
                ? t("builder.card.suggestRadio", { count: optionCount })
                : t("builder.card.displayHint", {
                    max: RADIO_RECOMMENDED_MAX,
                  })}
          </p>
        </div>
      )}

      {isChoiceType(question.type) && (
        <OptionsEditor question={question} update={update} />
      )}

      {!isChoiceType(question.type) && !supportsPlaceholder(question.type) && (
        <div className="flex flex-col gap-1.5">
          <FieldPreview question={question} />
          <p className="text-xs text-muted-foreground">
            {t("builder.card.moreOnRight")}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 border-t pt-3">
        <Switch
          id="q-required"
          checked={question.required}
          onCheckedChange={(required) => update({ required })}
        />
        <Label htmlFor="q-required">{t("builder.inspector.required")}</Label>
      </div>
    </div>
  );
}

/** What respondents will see, drawn small and inert (not a real control). */
function FieldPreview({ question }: { question: Question }) {
  const t = useTranslations();
  const box =
    "flex w-full max-w-md items-center rounded-md border border-dashed bg-background/60 px-3 text-sm text-muted-foreground";
  const placeholder = question.placeholder?.trim();
  const options = question.options ?? [];
  const shown = options.slice(0, RADIO_RECOMMENDED_MAX);

  switch (question.type) {
    case "short_text":
    case "email":
    case "phone":
    case "number":
      return (
        <span aria-hidden className={cn(box, "h-9")}>
          {placeholder || t("renderer.textPlaceholder")}
        </span>
      );
    case "paragraph":
      return (
        <span aria-hidden className={cn(box, "h-16 items-start py-2")}>
          {placeholder || t("renderer.textPlaceholder")}
        </span>
      );
    case "date":
      return (
        <span aria-hidden className={cn(box, "h-9 max-w-48 justify-between")}>
          {t("builder.card.datePreview")}
          <CalendarDays className="size-4" />
        </span>
      );
    case "dropdown":
      return (
        <span aria-hidden className="flex w-full max-w-md flex-col gap-1">
          <span className={cn(box, "h-9 justify-between")}>
            {placeholder || t("renderer.chooseOption")}
            <ChevronsUpDown className="size-4" />
          </span>
          <span className="text-xs text-muted-foreground">
            {t("builder.card.dropdownSummary", { count: options.length })}
          </span>
        </span>
      );
    case "multiple_choice":
    case "checkboxes":
      return (
        <span aria-hidden className="flex flex-col gap-1.5">
          {shown.map((o) => (
            <span key={o.id} className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-4 shrink-0 border-2 border-muted-foreground/50",
                  question.type === "checkboxes"
                    ? "rounded-[4px]"
                    : "rounded-full",
                )}
              />
              <span className="line-clamp-1">{o.label || "—"}</span>
            </span>
          ))}
          {options.length > shown.length && (
            <span className="pl-6 text-xs text-muted-foreground">
              {t("builder.card.moreOptions", {
                count: options.length - shown.length,
              })}
            </span>
          )}
          {question.allowOther && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className={cn(
                  "size-4 shrink-0 border-2 border-muted-foreground/50",
                  question.type === "checkboxes"
                    ? "rounded-[4px]"
                    : "rounded-full",
                )}
              />
              {t("builder.other")}
            </span>
          )}
        </span>
      );
    case "rating":
      return (
        <span aria-hidden className="flex gap-0.5 text-muted-foreground/60">
          {Array.from({ length: question.rating?.max ?? 5 }, (_, i) => (
            <Star key={i} className="size-5" />
          ))}
        </span>
      );
    case "linear_scale": {
      const min = question.scale?.min ?? 1;
      const max = question.scale?.max ?? 5;
      return (
        <span aria-hidden className="flex flex-col gap-1">
          <span className="flex flex-wrap gap-1">
            {Array.from({ length: max - min + 1 }, (_, i) => (
              <span
                key={i}
                className="flex size-7 items-center justify-center rounded border border-dashed text-xs text-muted-foreground"
              >
                {min + i}
              </span>
            ))}
          </span>
          {(question.scale?.minLabel || question.scale?.maxLabel) && (
            <span className="flex max-w-md justify-between gap-4 text-xs text-muted-foreground">
              <span>{question.scale?.minLabel}</span>
              <span>{question.scale?.maxLabel}</span>
            </span>
          )}
        </span>
      );
    }
  }
}
