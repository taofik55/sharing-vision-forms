"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Ban, ClipboardPaste, GripVertical, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { moveOption, newId, optionsFromLines } from "@/lib/forms/operations";
import { LIMITS, type Option, type Question } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";

/** Marker before each option: what respondents will see. */
function OptionMarker({
  type,
  index,
}: {
  type: Question["type"];
  index: number;
}) {
  if (type === "dropdown" || type === "ranking")
    return (
      <span
        className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
        aria-hidden
      >
        {index + 1}.
      </span>
    );
  return (
    <span
      aria-hidden
      className={cn(
        "size-4 shrink-0 border-2 border-muted-foreground/50",
        type === "checkboxes" ? "rounded-[4px]" : "rounded-full",
      )}
    />
  );
}

type OptionsEditorProps = {
  question: Question;
  update: (patch: Partial<Question>, coalesceKey?: string) => void;
  /** options (also a grid's columns) or a grid's rows. */
  field?: "options" | "rows";
};

export function OptionsEditor({
  question,
  update,
  field = "options",
}: OptionsEditorProps) {
  const t = useTranslations("builder");
  const rows = field === "rows";
  const options = (rows ? question.grid?.rows : question.options) ?? [];
  // "None"-type options that clear the rest: multi-select lists, grid columns.
  const exclusiveAllowed =
    !rows &&
    (question.type === "checkboxes" ||
      (question.type === "grid" && Boolean(question.grid?.multiple)));
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const limit = rows ? LIMITS.gridRows : LIMITS.options;

  const setOptions = (next: Option[], key?: string) =>
    rows
      ? update({ grid: { multiple: false, ...question.grid, rows: next } }, key)
      : update({ options: next }, key);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.id === active.id);
    const to = options.findIndex((o) => o.id === over.id);
    if (from >= 0 && to >= 0) setOptions(moveOption(options, from, to));
  }

  const heading = rows
    ? t("inspector.gridRows")
    : question.type === "grid"
      ? t("inspector.gridColumns")
      : t("inspector.options");

  return (
    <div className="flex flex-col gap-2" data-testid={`options-${field}`}>
      <Label>{heading}</Label>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={options.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="flex flex-col gap-1.5">
            {options.map((option, index) => (
              <OptionRow
                key={option.id}
                option={option}
                index={index}
                type={rows ? "multiple_choice" : question.type}
                exclusiveAllowed={exclusiveAllowed}
                onChange={(patch) =>
                  setOptions(
                    options.map((o) => {
                      if (o.id !== option.id) return o;
                      const next: Option = { ...o, ...patch };
                      if (!next.code) delete next.code;
                      if (!next.exclusive) delete next.exclusive;
                      return next;
                    }),
                    `${field}:${option.id}:${Object.keys(patch)[0]}`,
                  )
                }
                onRemove={() =>
                  setOptions(options.filter((o) => o.id !== option.id))
                }
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={options.length >= limit}
          onClick={() =>
            setOptions([
              ...options,
              {
                id: newId(),
                label: rows
                  ? t("row", { number: options.length + 1 })
                  : t("option", { number: options.length + 1 }),
              },
            ])
          }
          data-testid={`add-${field}`}
        >
          <Plus aria-hidden />
          {rows ? t("inspector.addRow") : t("inspector.addOption")}
        </Button>
        <Popover open={pasteOpen} onOpenChange={setPasteOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <ClipboardPaste aria-hidden />
              {t("inspector.pasteOptions")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2">
            <Label htmlFor={`paste-${field}`}>
              {t("inspector.pasteOptions")}
            </Label>
            <Textarea
              id={`paste-${field}`}
              rows={6}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("inspector.pasteHint")}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOptions(optionsFromLines(paste, options).slice(0, limit));
                setPaste("");
                setPasteOpen(false);
              }}
            >
              {t("inspector.addPasted")}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {!rows && question.type !== "grid" && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Label htmlFor="allow-other">{t("inspector.allowOther")}</Label>
          <Switch
            id="allow-other"
            checked={Boolean(question.allowOther)}
            onCheckedChange={(checked) =>
              update({ allowOther: checked || undefined })
            }
          />
        </div>
      )}
    </div>
  );
}

function OptionRow({
  option,
  index,
  type,
  exclusiveAllowed,
  onChange,
  onRemove,
}: {
  option: Option;
  index: number;
  type: Question["type"];
  exclusiveAllowed: boolean;
  onChange: (patch: Partial<Option>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("builder.inspector");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({
    id: option.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className="flex items-center gap-1"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("moveOption", { number: index + 1 })}
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <OptionMarker type={type} index={index} />
      <Input
        value={option.code ?? ""}
        maxLength={LIMITS.optionCode}
        aria-label={t("optionCode", { number: index + 1 })}
        placeholder={t("codePlaceholder")}
        onChange={(e) => onChange({ code: e.target.value.trim() || undefined })}
        className="h-8 w-12 shrink-0 px-1.5 text-center font-mono text-xs"
        data-testid="option-code"
      />
      <Input
        value={option.label}
        maxLength={LIMITS.optionLabel}
        aria-label={t("optionLabel", { number: index + 1 })}
        onChange={(e) => onChange({ label: e.target.value })}
        className="h-8"
      />
      {exclusiveAllowed && (
        <Button
          type="button"
          variant={option.exclusive ? "secondary" : "ghost"}
          size="icon"
          className="size-8 shrink-0"
          aria-pressed={Boolean(option.exclusive)}
          aria-label={t("exclusiveOption")}
          title={t("exclusiveOption")}
          onClick={() =>
            onChange({ exclusive: !option.exclusive || undefined })
          }
        >
          <Ban aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t("removeOption")}
        onClick={onRemove}
      >
        <X aria-hidden />
      </Button>
    </li>
  );
}
