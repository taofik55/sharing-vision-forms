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
  isChoiceType,
  isNumericType,
  operatorNeedsValue,
  operatorsForType,
  type Condition,
  type ConditionGroup,
  type ConditionOperator,
  type Question,
} from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useBuilder } from "./builder-context";
import { RADIO_ON } from "./choice-style";

type LogicEditorProps = {
  question: Question;
  update: (patch: Partial<Question>, coalesceKey?: string) => void;
};

function defaultCondition(ref: Question): Condition {
  return { questionKey: ref.key, operator: "is_answered" };
}

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
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" id="logic-combinator">
              {t("combinator")}
            </span>
            {/* Two choices: radio buttons, not a dropdown. */}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={group.combinator}
              onValueChange={(value) =>
                value &&
                setGroup({ ...group, combinator: value as "and" | "or" })
              }
              aria-labelledby="logic-combinator"
              className="w-full"
            >
              <ToggleGroupItem value="and" className={cn("flex-1", RADIO_ON)}>
                {t("and")}
              </ToggleGroupItem>
              <ToggleGroupItem value="or" className={cn("flex-1", RADIO_ON)}>
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
                earlier={earlier}
                onChange={(next, key) =>
                  setGroup(
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
                  const conditions = group.conditions.filter(
                    (_, i) => i !== index,
                  );
                  setGroup(
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
            disabled={
              group.conditions.length >= LIMITS.conditions ||
              earlier.length === 0
            }
            onClick={() =>
              setGroup({
                ...group,
                conditions: [
                  ...group.conditions,
                  defaultCondition(earlier[earlier.length - 1]),
                ],
              })
            }
          >
            <Plus aria-hidden />
            {t("addCondition")}
          </Button>
        </>
      )}
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
          className="h-8 min-w-0 text-sm"
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
            label: q.title || t("builder.untitledQuestion"),
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
          {/* At most six operators: radio buttons that wrap. */}
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
                condition.value !== undefined
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
          {operatorNeedsValue(condition.operator) && (
            <ValueInput
              question={ref}
              value={condition.value}
              onChange={(value, key) => onChange({ ...condition, value }, key)}
            />
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

  if (isChoiceType(question.type)) {
    const options = [
      ...(question.options ?? []),
      ...(question.allowOther
        ? [{ id: OTHER_OPTION_ID, label: t("builder.other") }]
        : []),
    ];
    return (
      <Combobox
        className="h-8 text-sm"
        aria-label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={(v) => onChange(v)}
        options={options.map((o) => ({ value: o.id, label: o.label || "—" }))}
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
