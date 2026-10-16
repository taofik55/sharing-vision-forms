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
import { ClipboardPaste, GripVertical, Plus, X } from "lucide-react";
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
  if (type === "dropdown")
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
};

export function OptionsEditor({ question, update }: OptionsEditorProps) {
  const t = useTranslations("builder");
  const options = question.options ?? [];
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const setOptions = (next: Option[], key?: string) =>
    update({ options: next }, key);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.id === active.id);
    const to = options.findIndex((o) => o.id === over.id);
    if (from >= 0 && to >= 0) setOptions(moveOption(options, from, to));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("inspector.options")}</Label>
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
                type={question.type}
                onChange={(label) =>
                  setOptions(
                    options.map((o) =>
                      o.id === option.id ? { ...o, label } : o,
                    ),
                    `option:${option.id}`,
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
          disabled={options.length >= LIMITS.options}
          onClick={() =>
            setOptions([
              ...options,
              {
                id: newId(),
                label: t("option", { number: options.length + 1 }),
              },
            ])
          }
        >
          <Plus aria-hidden />
          {t("inspector.addOption")}
        </Button>
        <Popover open={pasteOpen} onOpenChange={setPasteOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <ClipboardPaste aria-hidden />
              {t("inspector.pasteOptions")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2">
            <Label htmlFor="paste-options">{t("inspector.pasteOptions")}</Label>
            <Textarea
              id="paste-options"
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
                setOptions(
                  optionsFromLines(paste, options).slice(0, LIMITS.options),
                );
                setPaste("");
                setPasteOpen(false);
              }}
            >
              {t("inspector.addPasted")}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
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
    </div>
  );
}

function OptionRow({
  option,
  index,
  type,
  onChange,
  onRemove,
}: {
  option: Option;
  index: number;
  type: Question["type"];
  onChange: (label: string) => void;
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
        value={option.label}
        maxLength={LIMITS.optionLabel}
        aria-label={t("optionLabel", { number: index + 1 })}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
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
