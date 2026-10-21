"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LIMITS,
  OTHER_OPTION_ID,
  flattenQuestions,
  hasOptions,
  isNumericType,
  operatorNeedsValue,
  operatorTakesQuestion,
  operatorsForType,
  type Condition,
  type ConditionGroup,
  type ConditionOperator,
  type Question,
} from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useBuilder } from "./builder-context";
import { RADIO_ON } from "./choice-style";

// Long labels ("salah satu kondisi (ATAU)") wrap inside a narrow inspector.
const COMBINATOR =
  "h-auto min-h-8 min-w-0 flex-1 whitespace-normal py-1 text-xs";

type LogicEditorProps = {
  question: Question;
  update: (patch: Partial<Question>, coalesceKey?: string) => void;
};

export function defaultCondition(ref: Question): Condition {
  return { questionKey: ref.key, operator: "is_answered" };
}

/** "S5 · Bank operasional" for pickers. */
export function questionLabel(q: Question, untitled: string): string {
  return `${q.code ? `${q.code} · ` : ""}${q.title || untitled}`;
}

/** Show-if logic of one question (conditions on earlier questions). */
export function LogicEditor({ question, update }: LogicEditorProps) {
  const t = useTranslations("builder.logic");
  const { definition } = useBuilder();
  const all = flattenQuestions(definition);
  const earlier = all.slice(
    0,
    all.findIndex((q) => q.id === question.id),
  );
  const group = question.showIf;

  const setGroup = (next: ConditionGroup | undefined, key?: string) =>
    update({ showIf: next }, key);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="logic-enable">{t("enable")}</Label>
        <Switch
          id="logic-enable"
          checked={Boolean(group)}
          disabled={!group && earlier.length === 0}
          onCheckedChange={(checked) =>
            setGroup(
              checked
                ? {
                    combinator: "and",
                    conditions: [defaultCondition(earlier[earlier.length - 1])],
                  }
                : undefined,
            )
          }
          data-testid="logic-enable"
        />
      </div>
      {!group && earlier.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("noEarlierQuestions")}
        </p>
      )}
      {group && (
        <ConditionGroupEditor
          idPrefix="logic"
          group={group}
          candidates={earlier}
          onChange={setGroup}
        />
      )}
    </div>
  );
}

/**
 * One condition group (AND / OR of conditions on candidate questions).
 * Shared by show-if logic and screen-out / jump rules.
 */
export function ConditionGroupEditor({
  idPrefix,
  group,
  candidates,
  onChange,
}: {
  idPrefix: string;
  group: ConditionGroup;
  candidates: Question[];
  onChange: (group: ConditionGroup | undefined, coalesceKey?: string) => void;
}) {
  const t = useTranslations("builder.logic");
  const last = candidates[candidates.length - 1];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium" id={`${idPrefix}-combinator`}>
          {t("combinator")}
        </span>
        {/* Two choices: radio buttons, not a dropdown. */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={group.combinator}
          onValueChange={(value) =>
            value && onChange({ ...group, combinator: value as "and" | "or" })
          }
          aria-labelledby={`${idPrefix}-combinator`}
          className="w-full"
        >
          <ToggleGroupItem value="and" className={cn(COMBINATOR, RADIO_ON)}>
            {t("and")}
          </ToggleGroupItem>
          <ToggleGroupItem value="or" className={cn(COMBINATOR, RADIO_ON)}>
            {t("or")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <ol className="flex flex-col gap-2">
        {group.conditions.map((condition, index) => (
          <ConditionRow
            key={index}
            index={index}
            condition={condition}
            earlier={candidates}
            onChange={(next, key) =>
              onChange(
                {
                  ...group,
                  conditions: group.conditions.map((c, i) =>
                    i === index ? next : c,
                  ),
                },
                key,
              )
            }
            onRemove={() => {
              const conditions = group.conditions.filter((_, i) => i !== index);
              onChange(
                conditions.length ? { ...group, conditions } : undefined,
              );
            }}
          />
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={group.conditions.length >= LIMITS.conditions || !last}
        onClick={() =>
          last &&
          onChange({
            ...group,
            conditions: [...group.conditions, defaultCondition(last)],
          })
        }
      >
        <Plus aria-hidden />
        {t("addCondition")}
      </Button>
    </div>
  );
}

function ConditionRow({
  index,
  condition,
  earlier,
  onChange,
  onRemove,
}: {
  index: number;
  condition: Condition;
  earlier: Question[];
  onChange: (condition: Condition, coalesceKey?: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const ref = earlier.find((q) => q.key === condition.questionKey);
  const operators = ref ? operatorsForType(ref.type) : [];
  const untitled = t("builder.untitledQuestion");
  const compareWith = earlier.filter(
    (q) =>
      hasOptions(q.type) &&
      q.type !== "grid" &&
      q.key !== condition.questionKey,
  );

  const operatorLabel = (op: ConditionOperator) =>
    ref?.type === "date" && (op === "gt" || op === "lt")
      ? t(`operators.${op === "gt" ? "gtDate" : "ltDate"}`)
      : t(`operators.${op}`);

  return (
    <li
      className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2"
      data-testid={`condition-${index}`}
    >
      <div className="flex items-center gap-1">
        <Combobox
          className="h-8 min-w-0 flex-1 text-sm"
          aria-label={t("builder.logic.question")}
          value={ref ? condition.questionKey : undefined}
          onChange={(key) => {
            const next = earlier.find((q) => q.key === key);
            if (next)
              onChange({
                questionKey: key,
                operator: operatorsForType(next.type)[0],
              });
          }}
          options={earlier.map((q) => ({
            value: q.key,
            label: questionLabel(q, untitled),
          }))}
          placeholder={t("builder.logic.chooseQuestion")}
          searchPlaceholder={t("builder.search")}
          emptyText={t("builder.noMatches")}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={t("builder.logic.removeCondition")}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      </div>
      {ref && (
        <div className="flex flex-col gap-2">
          {/* A handful of operators: radio buttons that wrap. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            value={
              operators.includes(condition.operator) ? condition.operator : ""
            }
            onValueChange={(op) => {
              if (!op) return;
              const operator = op as ConditionOperator;
              onChange({
                questionKey: condition.questionKey,
                operator,
                ...(operatorNeedsValue(operator) &&
                condition.value !== undefined &&
                operatorTakesQuestion(operator) ===
                  operatorTakesQuestion(condition.operator)
                  ? { value: condition.value }
                  : {}),
              });
            }}
            aria-label={t("builder.logic.operator")}
            className="flex-wrap justify-start"
          >
            {operators.map((op) => (
              <ToggleGroupItem
                key={op}
                value={op}
                className={cn("h-7 px-2 text-xs", RADIO_ON)}
              >
                {operatorLabel(op)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {operatorTakesQuestion(condition.operator) ? (
            <Combobox
              className="h-8 text-sm"
              aria-label={t("builder.logic.otherQuestion")}
              value={
                typeof condition.value === "string"
                  ? condition.value
                  : undefined
              }
              onChange={(v) => onChange({ ...condition, value: v })}
              options={compareWith.map((q) => ({
                value: q.key,
                label: questionLabel(q, untitled),
              }))}
              placeholder={t("builder.logic.chooseQuestion")}
              searchPlaceholder={t("builder.search")}
              emptyText={t("builder.noMatches")}
            />
          ) : (
            operatorNeedsValue(condition.operator) && (
              <ValueInput
                question={ref}
                value={condition.value}
                onChange={(value, key) =>
                  onChange({ ...condition, value }, key)
                }
              />
            )
          )}
        </div>
      )}
    </li>
  );
}

function ValueInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: Condition["value"];
  onChange: (value: Condition["value"], coalesceKey?: string) => void;
}) {
  const t = useTranslations();
  const label = t("builder.logic.value");

  if (hasOptions(question.type)) {
    const options = [
      ...(question.options ?? []),
      ...(question.allowOther
        ? [{ id: OTHER_OPTION_ID, label: t("builder.other"), code: undefined }]
        : []),
    ];
    return (
      <Combobox
        className="h-8 text-sm"
        aria-label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={(v) => onChange(v)}
        options={options.map((o) => ({
          value: o.id,
          label: `${o.code ? `${o.code} · ` : ""}${o.label || "—"}`,
        }))}
        placeholder={t("builder.logic.chooseValue")}
        searchPlaceholder={t("builder.search")}
        emptyText={t("builder.noMatches")}
      />
    );
  }
  if (isNumericType(question.type)) {
    return (
      <Input
        type="number"
        className="h-8"
        aria-label={label}
        value={typeof value === "number" ? value : ""}
        onChange={(e) =>
          onChange(
            e.target.value === "" ? undefined : Number(e.target.value),
            "condition-value",
          )
        }
      />
    );
  }
  if (question.type === "date") {
    return (
      <Input
        type="date"
        className="h-8"
        aria-label={label}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  }
  return (
    <Input
      className="h-8"
      aria-label={label}
      maxLength={LIMITS.optionLabel}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value || undefined, "condition-value")}
    />
  );
}
