"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Combobox } from "@/components/combobox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  changeQuestionType,
  findQuestion,
  moveQuestion,
  replaceQuestion,
  updateQuestion,
  updateSection,
  validationKeysFor,
} from "@/lib/forms/operations";
import {
  LIMITS,
  QUESTION_TYPES,
  type Question,
  type QuestionType,
  type Section,
  type ValidationRules,
} from "@/lib/forms/schema";
import { useBuilder } from "./builder-context";
import { cn } from "@/lib/utils";
import { RADIO_ON } from "./choice-style";
import { LogicEditor } from "./logic-editor";
import { QuestionTypeIcon } from "./question-type-icon";

/** Few fixed choices (3 to 10 stars, scale ends): radio buttons, not a dropdown. */
function NumberChoice({
  id,
  label,
  values,
  value,
  onChange,
}: {
  id: string;
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm leading-none font-medium">
        {label}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={String(value)}
        onValueChange={(v) => v && onChange(Number(v))}
        aria-labelledby={id}
        className="flex-wrap justify-start"
        spacing={1}
      >
        {values.map((n) => (
          <ToggleGroupItem
            key={n}
            value={String(n)}
            className={cn("h-8 min-w-8 px-2 tabular-nums", RADIO_ON)}
          >
            {n}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function Inspector() {
  const t = useTranslations("builder.inspector");
  const { definition, selection } = useBuilder();

  if (selection?.kind === "question") {
    const loc = findQuestion(definition, selection.id);
    if (loc)
      return (
        <QuestionInspector
          key={loc.question.id}
          question={loc.question}
          sectionId={loc.section.id}
        />
      );
  }
  if (selection?.kind === "section") {
    const section = definition.sections.find((s) => s.id === selection.id);
    if (section) return <SectionInspector key={section.id} section={section} />;
  }
  return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
}

function SectionInspector({ section }: { section: Section }) {
  const t = useTranslations("builder");
  const { definition, apply } = useBuilder();
  return (
    <div className="flex flex-col gap-4" data-testid="section-inspector">
      <div className="flex flex-col gap-2">
        <Label htmlFor="section-title">{t("section.titlePlaceholder")}</Label>
        <Input
          id="section-title"
          value={section.title}
          maxLength={LIMITS.title}
          onChange={(e) =>
            apply(
              updateSection(definition, section.id, { title: e.target.value }),
              `${section.id}:title`,
            )
          }
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="section-description">
          {t("inspector.descriptionLabel")}
        </Label>
        <Textarea
          id="section-description"
          rows={3}
          value={section.description ?? ""}
          maxLength={LIMITS.description}
          placeholder={t("section.descriptionPlaceholder")}
          onChange={(e) =>
            apply(
              updateSection(definition, section.id, {
                description: e.target.value,
              }),
              `${section.id}:description`,
            )
          }
        />
      </div>
    </div>
  );
}

function QuestionInspector({
  question,
  sectionId,
}: {
  question: Question;
  sectionId: string;
}) {
  const t = useTranslations();
  const { definition, apply, labels } = useBuilder();
  const [pendingType, setPendingType] = useState<QuestionType | null>(null);

  const update = (patch: Partial<Question>, key?: string) =>
    apply(
      updateQuestion(definition, question.id, patch),
      key ? `${question.id}:${key}` : undefined,
    );

  function changeType(type: QuestionType, confirmed = false) {
    const { question: next, lostOptions } = changeQuestionType(
      question,
      type,
      labels,
    );
    if (lostOptions && !confirmed) {
      setPendingType(type);
      return;
    }
    apply(replaceQuestion(definition, next));
    setPendingType(null);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="question-inspector">
      <div>
        <h2 className="text-sm font-semibold">
          {t("builder.inspector.advanced")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("builder.inspector.advancedHint")}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="q-type">{t("builder.inspector.type")}</Label>
        <Combobox
          id="q-type"
          value={question.type}
          onChange={(v) => changeType(v as QuestionType)}
          options={QUESTION_TYPES.map((type) => ({
            value: type,
            label: t(`questionTypes.${type}`),
            icon: <QuestionTypeIcon type={type} />,
          }))}
          placeholder={t("builder.inspector.type")}
          searchPlaceholder={t("builder.search")}
          emptyText={t("builder.noMatches")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="q-section">
          {t("builder.inspector.moveToSection")}
        </Label>
        <Combobox
          id="q-section"
          value={sectionId}
          onChange={(target) => {
            const to = definition.sections.find((s) => s.id === target);
            if (to && target !== sectionId)
              apply(
                moveQuestion(
                  definition,
                  question.id,
                  target,
                  to.questions.length,
                ),
              );
          }}
          options={definition.sections.map((s, i) => ({
            value: s.id,
            label: `${i + 1}. ${s.title || t("builder.section.titlePlaceholder")}`,
          }))}
          placeholder={t("builder.inspector.moveToSection")}
          searchPlaceholder={t("builder.search")}
          emptyText={t("builder.noMatches")}
        />
      </div>

      {question.type === "linear_scale" && (
        <>
          <Separator />
          <ScaleSettings question={question} update={update} />
        </>
      )}

      {question.type === "rating" && (
        <>
          <Separator />
          <NumberChoice
            id="q-rating"
            label={t("builder.inspector.ratingMax")}
            values={range(3, 10)}
            value={question.rating?.max ?? 5}
            onChange={(max) => update({ rating: { max } })}
          />
        </>
      )}

      {validationKeysFor(question.type).length > 0 && (
        <>
          <Separator />
          <ValidationSettings question={question} update={update} />
        </>
      )}

      <Separator />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{t("builder.logic.title")}</h3>
        <LogicEditor question={question} update={update} />
      </div>

      <Separator />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          {t("builder.inspector.key")}
        </span>
        <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">
          {question.key}
        </code>
        <span className="text-xs text-muted-foreground">
          {t("builder.inspector.keyHint")}
        </span>
      </div>

      <ConfirmDialog
        open={pendingType !== null}
        onOpenChange={(open) => !open && setPendingType(null)}
        title={t("builder.inspector.changeTypeTitle")}
        description={t("builder.inspector.changeTypeDescription")}
        confirmLabel={t("builder.inspector.changeTypeConfirm")}
        destructive
        onConfirm={() => pendingType && changeType(pendingType, true)}
      />
    </div>
  );
}

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function ScaleSettings({
  question,
  update,
}: {
  question: Question;
  update: (p: Partial<Question>, k?: string) => void;
}) {
  const t = useTranslations("builder.inspector");
  const scale = question.scale ?? { min: 1, max: 5 };
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t("scale")}</h3>
      <NumberChoice
        id="scale-min"
        label={t("scaleFrom")}
        values={[0, 1]}
        value={scale.min}
        onChange={(min) => update({ scale: { ...scale, min: min as 0 | 1 } })}
      />
      <NumberChoice
        id="scale-max"
        label={t("scaleTo")}
        values={range(3, 10)}
        value={scale.max}
        onChange={(max) => update({ scale: { ...scale, max } })}
      />
      {(["minLabel", "maxLabel"] as const).map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <Label htmlFor={`scale-${field}`}>{t(field)}</Label>
          <Input
            id={`scale-${field}`}
            value={scale[field] ?? ""}
            maxLength={LIMITS.scaleLabel}
            onChange={(e) => {
              const next = { ...scale, [field]: e.target.value };
              if (!e.target.value) delete next[field];
              update({ scale: next }, `scale-${field}`);
            }}
          />
        </div>
      ))}
    </div>
  );
}

type NumberRule = "minLength" | "maxLength" | "min" | "max";

function ValidationSettings({
  question,
  update,
}: {
  question: Question;
  update: (p: Partial<Question>, k?: string) => void;
}) {
  const t = useTranslations("builder.inspector");
  const keys = validationKeysFor(question.type);
  const rules = question.validation ?? {};
  const isCheckboxes = question.type === "checkboxes";

  function set(patch: Partial<ValidationRules>, key: string) {
    const next: ValidationRules = { ...rules, ...patch };
    for (const k of Object.keys(next) as (keyof ValidationRules)[]) {
      if (next[k] === undefined || next[k] === "" || next[k] === false)
        delete next[k];
    }
    update(
      { validation: Object.keys(next).length ? next : undefined },
      `validation:${key}`,
    );
  }

  const numberLabel: Record<NumberRule, string> = {
    minLength: t("minLength"),
    maxLength: t("maxLength"),
    min: isCheckboxes ? t("minSelections") : t("min"),
    max: isCheckboxes ? t("maxSelections") : t("max"),
  };

  const parse = (raw: string, rule: NumberRule): number | undefined => {
    if (raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    if (rule === "minLength" || rule === "maxLength" || isCheckboxes) {
      return Math.max(
        rule === "maxLength" ? 1 : 0,
        Math.min(100_000, Math.trunc(n)),
      );
    }
    return n;
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t("validation")}</h3>
      <div className="grid grid-cols-2 gap-3">
        {(
          keys.filter((k) =>
            ["minLength", "maxLength", "min", "max"].includes(k),
          ) as NumberRule[]
        ).map((rule) => (
          <div key={rule} className="flex flex-col gap-2">
            <Label htmlFor={`rule-${rule}`}>{numberLabel[rule]}</Label>
            <Input
              id={`rule-${rule}`}
              type="number"
              inputMode="numeric"
              value={rules[rule] ?? ""}
              onChange={(e) =>
                set({ [rule]: parse(e.target.value, rule) }, rule)
              }
            />
          </div>
        ))}
        {(["minDate", "maxDate"] as const)
          .filter((k) => keys.includes(k))
          .map((rule) => (
            <div key={rule} className="flex flex-col gap-2">
              <Label htmlFor={`rule-${rule}`}>{t(rule)}</Label>
              <Input
                id={`rule-${rule}`}
                type="date"
                value={rules[rule] ?? ""}
                onChange={(e) =>
                  set({ [rule]: e.target.value || undefined }, rule)
                }
              />
            </div>
          ))}
      </div>
      {keys.includes("pattern") && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="rule-pattern">{t("pattern")}</Label>
          <Input
            id="rule-pattern"
            className="font-mono"
            value={rules.pattern ?? ""}
            maxLength={LIMITS.pattern}
            onChange={(e) =>
              set({ pattern: e.target.value || undefined }, "pattern")
            }
          />
          <p className="text-xs text-muted-foreground">{t("patternHint")}</p>
        </div>
      )}
      {keys.includes("integerOnly") && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="rule-integer">{t("integerOnly")}</Label>
          <Switch
            id="rule-integer"
            checked={Boolean(rules.integerOnly)}
            onCheckedChange={(checked) =>
              set({ integerOnly: checked || undefined }, "integerOnly")
            }
          />
        </div>
      )}
    </div>
  );
}
