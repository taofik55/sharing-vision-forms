"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { useBuilder } from "./builder-context";

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
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-xs">{t("combinator")}</Label>
            <Select
              value={group.combinator}
              onValueChange={(value) =>
                setGroup({ ...group, combinator: value as "and" | "or" })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full"
                aria-label={t("combinator")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">{t("and")}</SelectItem>
                <SelectItem value="or">{t("or")}</SelectItem>
              </SelectContent>
            </Select>
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
        <Select
          value={ref ? condition.questionKey : ""}
          onValueChange={(key) => {
            const next = earlier.find((q) => q.key === key);
            if (next)
              onChange({
                questionKey: key,
                operator: operatorsForType(next.type)[0],
              });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full min-w-0"
            aria-label={t("builder.logic.question")}
          >
            <SelectValue placeholder={t("builder.logic.chooseQuestion")} />
          </SelectTrigger>
          <SelectContent>
            {earlier.map((q) => (
              <SelectItem key={q.key} value={q.key}>
                <span className="line-clamp-1">
                  {q.title || t("builder.untitledQuestion")}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
          <Select
            value={
              operators.includes(condition.operator) ? condition.operator : ""
            }
            onValueChange={(op) => {
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
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={t("builder.logic.operator")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {operatorLabel(op)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={(v) => onChange(v)}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue placeholder={t("builder.logic.chooseValue")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label || "—"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
