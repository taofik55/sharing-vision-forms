"use client";

import { useDraggable } from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { QUESTION_TYPES, type QuestionType } from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useBuilder } from "./builder-context";
import { QuestionTypeIcon } from "./question-type-icon";

export const PALETTE_PREFIX = "palette:";

function PaletteItem({ type }: { type: QuestionType }) {
  const t = useTranslations("questionTypes");
  const { addQuestionOfType } = useBuilder();
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${type}`,
    data: { kind: "palette", type },
  });

  // Keyboard users add with Enter/Space (native click); dragging is pointer/touch only here.
  const pointerListeners = { ...listeners };
  delete pointerListeners.onKeyDown;

  return (
    <li>
      <button
        ref={setNodeRef}
        type="button"
        {...pointerListeners}
        // Click adds; dnd-kit only starts a drag after 5px of movement.
        onClick={() => addQuestionOfType(type)}
        data-testid={`palette-${type}`}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
          isDragging && "opacity-50",
        )}
      >
        <QuestionTypeIcon type={type} />
        {t(type)}
      </button>
    </li>
  );
}

export function Palette() {
  const t = useTranslations("builder");
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">{t("palette")}</h2>
        <p className="text-xs text-muted-foreground">{t("paletteHint")}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {QUESTION_TYPES.map((type) => (
          <PaletteItem key={type} type={type} />
        ))}
      </ul>
    </div>
  );
}
