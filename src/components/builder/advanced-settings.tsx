"use client";

import { ArrowRightToLine, OctagonX, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LIMITS,
  flattenQuestions,
  hasOptions,
  isChoiceType,
  type Grid,
  type Question,
  type Rule,
} from "@/lib/forms/schema";
import { cn } from "@/lib/utils";
import { useBuilder } from "./builder-context";
import { RADIO_ON } from "./choice-style";
import {
  ConditionGroupEditor,
  defaultCondition,
  questionLabel,
} from "./logic-editor";
import { OptionsEditor } from "./options-editor";

type Update = (patch: Partial<Question>, coalesceKey?: string) => void;

const NONE = "__none__";

function useQuestionLists(question: Question) {
  const { definition } = useBuilder();
  const all = flattenQuestions(definition);
  const index = all.findIndex((q) => q.id === question.id);
  return { all, earlier: all.slice(0, index), later: all.slice(index + 1) };
}

/** Question code (S1, A2): shown to interviewers and in exports. */
export function CodeSetting({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations("builder.inspector");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="q-code">{t("code")}</Label>
      <Input
        id="q-code"
        className="max-w-40 font-mono"
        value={question.code ?? ""}
        maxLength={LIMITS.code}
        placeholder="S1"
        onChange={(e) => {
          const code = e.target.value.replace(/[^A-Za-z0-9_.-]/g, "");
          update({ code: code || undefined }, "code");
        }}
        data-testid="question-code"
      />
      <p className="text-xs text-muted-foreground">{t("codeHint")}</p>
    </div>
  );
}

export function RankingSettings({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations("builder.inspector");
  const count = Math.max(
    1,
    (question.options?.length ?? 1) + (question.allowOther ? 1 : 0),
  );
  const values = Array.from({ length: Math.min(10, count) }, (_, i) => i + 1);
  return (
    <div className="flex flex-col gap-2">
      <span id="ranking-max" className="text-sm font-medium">
        {t("rankingMax")}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1}
        value={String(question.ranking?.max ?? 3)}
        onValueChange={(v) => v && update({ ranking: { max: Number(v) } })}
        aria-labelledby="ranking-max"
        className="flex-wrap justify-start"
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
      <p className="text-xs text-muted-foreground">{t("rankingHint")}</p>
    </div>
  );
}

export function GridSettings({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations();
  const { earlier } = useQuestionLists(question);
  const grid: Grid = question.grid ?? { multiple: false, rows: [] };
  const set = (patch: Partial<Grid>, key?: string) =>
    update({ grid: { ...grid, ...patch } }, key);
  const sources = earlier.filter(
    (q) => hasOptions(q.type) && q.type !== "grid" && q.type !== "dropdown",
  );
  const columns = question.options ?? [];
  const untitled = t("builder.untitledQuestion");

  return (
    <div className="flex flex-col gap-3" data-testid="grid-settings">
      <h3 className="text-sm font-semibold">{t("builder.inspector.grid")}</h3>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="grid-multiple">
          {t("builder.inspector.gridMultiple")}
        </Label>
        <Switch
          id="grid-multiple"
          checked={grid.multiple}
          onCheckedChange={(multiple) => set({ multiple })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="grid-rows-from">
          {t("builder.inspector.rowsFrom")}
        </Label>
        <Combobox
          id="grid-rows-from"
          value={grid.rowsFrom ?? NONE}
          onChange={(v) => set({ rowsFrom: v === NONE ? undefined : v })}
          options={[
            { value: NONE, label: t("builder.inspector.rowsFixed") },
            ...sources.map((q) => ({
              value: q.key,
              label: questionLabel(q, untitled),
            })),
          ]}
          placeholder={t("builder.inspector.rowsFixed")}
          searchPlaceholder={t("builder.search")}
          emptyText={t("builder.noMatches")}
        />
        <p className="text-xs text-muted-foreground">
          {t("builder.inspector.rowsFromHint")}
        </p>
      </div>
      {!grid.rowsFrom && (
        <OptionsEditor question={question} update={update} field="rows" />
      )}
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="grid-random">
          {t("builder.inspector.randomizeRows")}
        </Label>
        <Switch
          id="grid-random"
          checked={Boolean(grid.randomizeRows)}
          onCheckedChange={(on) => set({ randomizeRows: on || undefined })}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="grid-straight">
          {t("builder.inspector.straightlining")}
        </Label>
        <Switch
          id="grid-straight"
          checked={Boolean(grid.straightlining)}
          onCheckedChange={(on) => set({ straightlining: on || undefined })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {t("builder.inspector.maxPerColumn")}
        </span>
        {(grid.maxPerColumn ?? []).map((limit, i) => (
          <div key={i} className="flex items-center gap-1">
            <Combobox
              className="h-8 min-w-0 text-sm"
              aria-label={t("builder.inspector.column")}
              value={limit.optionId}
              onChange={(optionId) =>
                set({
                  maxPerColumn: (grid.maxPerColumn ?? []).map((m, j) =>
                    j === i ? { ...m, optionId } : m,
                  ),
                })
              }
              options={columns.map((c) => ({
                value: c.id,
                label: `${c.code ? `${c.code} · ` : ""}${c.label}`,
              }))}
              placeholder={t("builder.inspector.column")}
              searchPlaceholder={t("builder.search")}
              emptyText={t("builder.noMatches")}
            />
            <Input
              type="number"
              min={0}
              max={LIMITS.gridRows}
              className="h-8 w-16"
              aria-label={t("builder.inspector.maxRows")}
              value={limit.max}
              onChange={(e) =>
                set(
                  {
                    maxPerColumn: (grid.maxPerColumn ?? []).map((m, j) =>
                      j === i
                        ? {
                            ...m,
                            max: Math.max(
                              0,
                              Math.min(
                                LIMITS.gridRows,
                                Number(e.target.value) || 0,
                              ),
                            ),
                          }
                        : m,
                    ),
                  },
                  `grid-max-${i}`,
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("builder.inspector.removeLimit")}
              onClick={() => {
                const next = (grid.maxPerColumn ?? []).filter(
                  (_, j) => j !== i,
                );
                set({ maxPerColumn: next.length ? next : undefined });
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={!columns.length || (grid.maxPerColumn?.length ?? 0) >= 10}
          onClick={() =>
            set({
              maxPerColumn: [
                ...(grid.maxPerColumn ?? []),
                { optionId: columns[columns.length - 1].id, max: 1 },
              ],
            })
          }
        >
          <Plus aria-hidden />
          {t("builder.inspector.addLimit")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Where options come from and in which order: random order (shared with
 * another question), carry-forward from an earlier answer, auto-ticked
 * options, "must differ from".
 */
export function OptionSourceSettings({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations();
  const { earlier } = useQuestionLists(question);
  const untitled = t("builder.untitledQuestion");
  const choiceSources = earlier.filter(
    (q) => hasOptions(q.type) && q.type !== "grid",
  );
  const orderSources = earlier.filter((q) => hasOptions(q.type));
  const randomizable = question.type !== "grid" || question.grid?.randomizeRows;
  const option = (q: Question) => ({
    value: q.key,
    label: questionLabel(q, untitled),
  });

  return (
    <div className="flex flex-col gap-3" data-testid="option-sources">
      <h3 className="text-sm font-semibold">
        {t("builder.inspector.optionSources")}
      </h3>
      {question.type !== "grid" && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="q-random">
            {t("builder.inspector.randomizeOptions")}
          </Label>
          <Switch
            id="q-random"
            checked={Boolean(question.randomizeOptions)}
            onCheckedChange={(on) =>
              update({ randomizeOptions: on || undefined })
            }
          />
        </div>
      )}
      {randomizable &&
        (question.randomizeOptions || question.type === "grid") && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="q-order-like">
              {t("builder.inspector.orderLike")}
            </Label>
            <Combobox
              id="q-order-like"
              value={question.orderLike ?? NONE}
              onChange={(v) =>
                update({ orderLike: v === NONE ? undefined : v })
              }
              options={[
                { value: NONE, label: t("builder.inspector.ownOrder") },
                ...orderSources.map(option),
              ]}
              placeholder={t("builder.inspector.ownOrder")}
              searchPlaceholder={t("builder.search")}
              emptyText={t("builder.noMatches")}
            />
          </div>
        )}
      {question.type !== "grid" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="q-options-from">
            {t("builder.inspector.optionsFrom")}
          </Label>
          <Combobox
            id="q-options-from"
            value={question.optionsFrom?.questionKey ?? NONE}
            onChange={(v) =>
              update({
                optionsFrom:
                  v === NONE
                    ? undefined
                    : {
                        questionKey: v,
                        mode: question.optionsFrom?.mode ?? "selected",
                      },
              })
            }
            options={[
              { value: NONE, label: t("builder.inspector.allOptions") },
              ...choiceSources.map(option),
            ]}
            placeholder={t("builder.inspector.allOptions")}
            searchPlaceholder={t("builder.search")}
            emptyText={t("builder.noMatches")}
          />
          {question.optionsFrom && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={question.optionsFrom.mode}
              onValueChange={(mode) =>
                mode &&
                update({
                  optionsFrom: {
                    ...question.optionsFrom!,
                    mode: mode as "selected" | "unselected",
                  },
                })
              }
              aria-label={t("builder.inspector.optionsFrom")}
              className="w-full"
            >
              <ToggleGroupItem
                value="selected"
                className={cn("flex-1 text-xs", RADIO_ON)}
              >
                {t("builder.inspector.fromSelected")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="unselected"
                className={cn("flex-1 text-xs", RADIO_ON)}
              >
                {t("builder.inspector.fromUnselected")}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <p className="text-xs text-muted-foreground">
            {t("builder.inspector.optionsFromHint")}
          </p>
        </div>
      )}
      {question.type === "checkboxes" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="q-auto-select">
            {t("builder.inspector.autoSelectFrom")}
          </Label>
          <Combobox
            id="q-auto-select"
            value={question.autoSelectFrom ?? NONE}
            onChange={(v) =>
              update({ autoSelectFrom: v === NONE ? undefined : v })
            }
            options={[
              { value: NONE, label: t("builder.inspector.none") },
              ...choiceSources.map(option),
            ]}
            placeholder={t("builder.inspector.none")}
            searchPlaceholder={t("builder.search")}
            emptyText={t("builder.noMatches")}
          />
        </div>
      )}
      {isChoiceType(question.type) && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="q-not-same">{t("builder.inspector.notSameAs")}</Label>
          <Combobox
            id="q-not-same"
            value={question.notSameAs ?? NONE}
            onChange={(v) => update({ notSameAs: v === NONE ? undefined : v })}
            options={[
              { value: NONE, label: t("builder.inspector.none") },
              ...choiceSources.map(option),
            ]}
            placeholder={t("builder.inspector.none")}
            searchPlaceholder={t("builder.search")}
            emptyText={t("builder.noMatches")}
          />
        </div>
      )}
    </div>
  );
}

/** Screen-outs ("STOP") and jumps ("→ lanjut C9") after this question. */
export function RulesEditor({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations();
  const { definition } = useBuilder();
  const { earlier, later } = useQuestionLists(question);
  const rules = question.rules ?? [];
  const candidates = [...earlier, question];
  const untitled = t("builder.untitledQuestion");
  const sectionIndex = definition.sections.findIndex((s) =>
    s.questions.some((q) => q.id === question.id),
  );
  const laterSections = definition.sections.slice(sectionIndex + 1);
  const targets = [
    ...laterSections.map((s, i) => ({
      value: s.id,
      label: `${t("builder.rules.section")} ${sectionIndex + i + 2}: ${s.title || "—"}`,
    })),
    ...later.map((q) => ({ value: q.key, label: questionLabel(q, untitled) })),
  ];

  const setRules = (next: Rule[], key?: string) =>
    update({ rules: next.length ? next : undefined }, key);
  const setRule = (i: number, patch: Partial<Rule>, key?: string) =>
    setRules(
      rules.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (!next.when?.conditions.length) delete next.when;
        if (next.action === "terminate") delete next.target;
        if (!next.reason) delete next.reason;
        return next;
      }),
      key,
    );

  return (
    <div className="flex flex-col gap-3" data-testid="rules-editor">
      <div>
        <h3 className="text-sm font-semibold">{t("builder.rules.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("builder.rules.hint")}
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {rules.map((rule, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-md border p-2"
            data-testid={`rule-${i}`}
          >
            <div className="flex items-center gap-1">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={rule.action}
                onValueChange={(action) =>
                  action && setRule(i, { action: action as Rule["action"] })
                }
                aria-label={t("builder.rules.action")}
                className="flex-1"
              >
                <ToggleGroupItem
                  value="terminate"
                  className={cn("flex-1 gap-1 text-xs", RADIO_ON)}
                >
                  <OctagonX aria-hidden />
                  {t("builder.rules.terminate")}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="jump"
                  className={cn("flex-1 gap-1 text-xs", RADIO_ON)}
                >
                  <ArrowRightToLine aria-hidden />
                  {t("builder.rules.jump")}
                </ToggleGroupItem>
              </ToggleGroup>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("builder.rules.remove")}
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            {rule.action === "jump" && (
              <Combobox
                className="h-8 text-sm"
                aria-label={t("builder.rules.target")}
                value={rule.target}
                onChange={(target) => setRule(i, { target })}
                options={targets}
                placeholder={t("builder.rules.target")}
                searchPlaceholder={t("builder.search")}
                emptyText={t("builder.noMatches")}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`rule-when-${i}`} className="text-xs">
                {rule.action === "jump"
                  ? t("builder.rules.onlyIf")
                  : t("builder.rules.when")}
              </Label>
              {rule.action === "jump" && (
                <Switch
                  id={`rule-when-${i}`}
                  checked={Boolean(rule.when)}
                  onCheckedChange={(on) =>
                    setRule(i, {
                      when: on
                        ? {
                            combinator: "and",
                            conditions: [defaultCondition(question)],
                          }
                        : undefined,
                    })
                  }
                />
              )}
            </div>
            {(rule.action === "terminate" || rule.when) && (
              <ConditionGroupEditor
                idPrefix={`rule-${i}`}
                group={rule.when ?? { combinator: "or", conditions: [] }}
                candidates={candidates}
                onChange={(when, key) => setRule(i, { when }, key)}
              />
            )}
            {rule.action === "terminate" && (
              <Input
                className="h-8"
                aria-label={t("builder.rules.reason")}
                placeholder={t("builder.rules.reason")}
                maxLength={LIMITS.optionLabel}
                value={rule.reason ?? ""}
                onChange={(e) =>
                  setRule(
                    i,
                    { reason: e.target.value || undefined },
                    `rule-reason-${i}`,
                  )
                }
              />
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rules.length >= LIMITS.rules}
          onClick={() =>
            setRules([
              ...rules,
              {
                action: "terminate",
                when: {
                  combinator: "or",
                  conditions: [defaultCondition(question)],
                },
              },
            ])
          }
          data-testid="add-terminate-rule"
        >
          <OctagonX aria-hidden />
          {t("builder.rules.addTerminate")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rules.length >= LIMITS.rules || targets.length === 0}
          onClick={() =>
            setRules([...rules, { action: "jump", target: targets[0]?.value }])
          }
          data-testid="add-jump-rule"
        >
          <ArrowRightToLine aria-hidden />
          {t("builder.rules.addJump")}
        </Button>
      </div>
    </div>
  );
}

/** Interviews: the surveyor must write a note for this question. */
export function NoteSetting({
  question,
  update,
}: {
  question: Question;
  update: Update;
}) {
  const t = useTranslations("builder.inspector");
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <Label htmlFor="q-note-required">{t("noteRequired")}</Label>
        <p className="text-xs text-muted-foreground">{t("noteRequiredHint")}</p>
      </div>
      <Switch
        id="q-note-required"
        checked={Boolean(question.noteRequired)}
        onCheckedChange={(on) => update({ noteRequired: on || undefined })}
      />
    </div>
  );
}
