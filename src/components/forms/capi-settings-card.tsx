"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { saveCapiSettingsAction } from "@/lib/forms/actions";
import {
  allCells,
  type CapiDimension,
  type CapiSettings,
} from "@/lib/forms/capi";
import type { Question } from "@/lib/forms/schema";
import { useRouter } from "@/lib/i18n/navigation";

type ChoiceQuestion = Pick<Question, "key" | "title" | "code" | "options">;

function questionLabel(q: ChoiceQuestion) {
  return `${q.code ? `${q.code} · ` : ""}${q.title}`;
}

/** Group code per option id (the editor's view of dimension groups). */
function codesByOption(d: CapiDimension): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of d.groups) for (const id of g.optionIds) out[id] = g.code;
  return out;
}

function groupsFromCodes(
  question: ChoiceQuestion | undefined,
  codes: Record<string, string>,
): CapiDimension["groups"] {
  const order: string[] = [];
  const byCode = new Map<string, string[]>();
  for (const o of question?.options ?? []) {
    const code = codes[o.id]?.trim().toUpperCase();
    if (!code) continue;
    if (!byCode.has(code)) {
      byCode.set(code, []);
      order.push(code);
    }
    byCode.get(code)!.push(o.id);
  }
  return order.map((code) => ({
    code,
    label: code,
    optionIds: byCode.get(code)!,
  }));
}

/**
 * Interview mode (CAPI): quota cells from up to four single-choice questions,
 * respondent IDs, QC thresholds and surveyor notes.
 */
export function CapiSettingsCard({
  formId,
  initial,
  questions,
}: {
  formId: string;
  initial: CapiSettings;
  /** Single-choice questions of the draft (dimension sources). */
  questions: ChoiceQuestion[];
}) {
  const t = useTranslations("capi");
  const router = useRouter();
  const [settings, setSettings] = useState<CapiSettings>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const byKey = new Map(questions.map((q) => [q.key, q]));

  const set = (patch: Partial<CapiSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const setDimension = (i: number, patch: Partial<CapiDimension>) =>
    set({
      dimensions: settings.dimensions.map((d, j) =>
        j === i ? { ...d, ...patch } : d,
      ),
    });

  function save() {
    startTransition(async () => {
      const result = await saveCapiSettingsAction({ formId, settings });
      if (result.ok) {
        setProblems([]);
        toast.success(t("saved"));
        router.refresh();
      } else {
        setProblems(
          "problems" in result && result.problems ? result.problems : [],
        );
        toast.error(t("saveError"));
      }
    });
  }

  const cells = allCells(settings);

  return (
    <div className="flex flex-col gap-5" data-testid="capi-settings">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="capi-enabled">{t("enabled")}</Label>
          <p className="text-xs text-muted-foreground">{t("enabledHint")}</p>
        </div>
        <Switch
          id="capi-enabled"
          checked={settings.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          data-testid="capi-enabled"
        />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="capi-notes">{t("notes")}</Label>
          <p className="text-xs text-muted-foreground">{t("notesHint")}</p>
        </div>
        <Switch
          id="capi-notes"
          checked={settings.notes}
          onCheckedChange={(notes) => set({ notes })}
        />
      </div>

      <Separator />
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("dimensions")}</h3>
          <p className="text-xs text-muted-foreground">{t("dimensionsHint")}</p>
        </div>
        {settings.dimensions.map((d, i) => {
          const q = byKey.get(d.questionKey);
          const codes = codesByOption(d);
          return (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-md border p-3"
              data-testid={`dimension-${i}`}
            >
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 max-w-40"
                  aria-label={t("dimensionLabel")}
                  placeholder={t("dimensionLabel")}
                  value={d.label}
                  maxLength={100}
                  onChange={(e) => setDimension(i, { label: e.target.value })}
                />
                <Combobox
                  className="h-8 min-w-0 flex-1 text-sm"
                  aria-label={t("dimensionQuestion")}
                  value={d.questionKey || undefined}
                  onChange={(key) =>
                    setDimension(i, { questionKey: key, groups: [] })
                  }
                  options={questions.map((x) => ({
                    value: x.key,
                    label: questionLabel(x),
                  }))}
                  placeholder={t("dimensionQuestion")}
                  searchPlaceholder={t("search")}
                  emptyText={t("noMatches")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("removeDimension")}
                  onClick={() =>
                    set({
                      dimensions: settings.dimensions.filter((_, j) => j !== i),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {q && (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {(q.options ?? []).map((o) => (
                    <li key={o.id} className="flex items-center gap-2 text-sm">
                      <Input
                        className="h-7 w-16 px-1.5 text-center font-mono text-xs uppercase"
                        aria-label={t("groupCodeFor", { option: o.label })}
                        maxLength={10}
                        value={codes[o.id] ?? ""}
                        onChange={(e) =>
                          setDimension(i, {
                            groups: groupsFromCodes(q, {
                              ...codes,
                              [o.id]: e.target.value.replace(
                                /[^A-Za-z0-9]/g,
                                "",
                              ),
                            }),
                          })
                        }
                        data-testid="group-code"
                      />
                      <span className="min-w-0 truncate">
                        {o.code ? `${o.code} · ` : ""}
                        {o.label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{t("groupHint")}</p>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={settings.dimensions.length >= 4 || !questions.length}
          onClick={() =>
            set({
              dimensions: [
                ...settings.dimensions,
                {
                  id: `d${Date.now().toString(36)}`.slice(0, 20),
                  label: "",
                  questionKey: questions[0]?.key ?? "",
                  groups: [],
                },
              ],
            })
          }
        >
          <Plus aria-hidden />
          {t("addDimension")}
        </Button>
        {cells.length > 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="cell-preview"
          >
            {t("cellsPreview", { count: cells.length, example: cells[0] })}
          </p>
        )}
      </section>

      <Separator />
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="quota-enabled">{t("quota")}</Label>
            <p className="text-xs text-muted-foreground">{t("quotaHint")}</p>
          </div>
          <Switch
            id="quota-enabled"
            checked={settings.quota.enabled}
            onCheckedChange={(enabled) =>
              set({ quota: { ...settings.quota, enabled } })
            }
          />
        </div>
        {settings.quota.enabled && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quota-target">{t("target")}</Label>
              <Input
                id="quota-target"
                type="number"
                min={1}
                value={settings.quota.target}
                onChange={(e) =>
                  set({
                    quota: {
                      ...settings.quota,
                      target: Math.max(1, Number(e.target.value) || 1),
                    },
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quota-reserve">{t("reserve")}</Label>
              <Input
                id="quota-reserve"
                type="number"
                min={0}
                value={settings.quota.reserve}
                onChange={(e) =>
                  set({
                    quota: {
                      ...settings.quota,
                      reserve: Math.max(0, Number(e.target.value) || 0),
                    },
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quota-check">{t("checkAfter")}</Label>
              <Combobox
                id="quota-check"
                value={settings.quota.checkAfter}
                onChange={(key) =>
                  set({ quota: { ...settings.quota, checkAfter: key } })
                }
                options={questions.map((x) => ({
                  value: x.key,
                  label: questionLabel(x),
                }))}
                placeholder={t("checkAfter")}
                searchPlaceholder={t("search")}
                emptyText={t("noMatches")}
              />
            </div>
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="rid-enabled">{t("respondentId")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("respondentIdHint", {
                example: `${cells[0] ?? "JKT-R-B"}-${"7".padStart(settings.respondentId.digits, "0")}`,
              })}
            </p>
          </div>
          <Switch
            id="rid-enabled"
            checked={settings.respondentId.enabled}
            onCheckedChange={(enabled) =>
              set({ respondentId: { ...settings.respondentId, enabled } })
            }
          />
        </div>
      </section>

      <Separator />
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("qc")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["minMinutes", 0, 600],
              ["maxMinutes", 1, 1440],
              ["backcheckPercent", 1, 100],
              ["otherPercent", 1, 100],
            ] as const
          ).map(([key, min, max]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`qc-${key}`}>{t(`qcFields.${key}`)}</Label>
              <Input
                id={`qc-${key}`}
                type="number"
                min={min}
                max={max}
                value={settings.qc[key]}
                onChange={(e) =>
                  set({
                    qc: {
                      ...settings.qc,
                      [key]: Math.min(
                        max,
                        Math.max(min, Number(e.target.value) || min),
                      ),
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>

      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive" role="alert">
          {problems.map((p) => (
            <li key={p}>{t(`problems.${p}` as "problems.needsDimensions")}</li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        className="self-start"
        disabled={isPending}
        onClick={save}
        data-testid="capi-save"
      >
        {isPending && <LoaderCircle className="animate-spin" aria-hidden />}
        {t("save")}
      </Button>
    </div>
  );
}
