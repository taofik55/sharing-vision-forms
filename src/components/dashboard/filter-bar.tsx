"use client";

import { Filter, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DATE_PRESETS,
  EMPTY_FILTERS,
  hasActiveFilters,
  type DashboardFilters,
} from "@/lib/analytics/filters";
import {
  isChoiceType,
  OTHER_OPTION_ID,
  type Question,
} from "@/lib/forms/schema";

const ALL = "__all__";

type FilterBarProps = {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
  questions: Record<string, Question>;
  versions: { id: string; number: number }[];
  showCompare?: boolean;
  optionLabel: (questionKey: string, optionId: string) => string;
  deviceLabel: (key: string) => string;
  languageLabel: (key: string) => string;
};

/** Global filters (URL state): date range, version, answers, device, language, compare. */
export function FilterBar({
  filters,
  onChange,
  questions,
  versions,
  showCompare = true,
  optionLabel,
  deviceLabel,
  languageLabel,
}: FilterBarProps) {
  const t = useTranslations("filters");
  const set = (patch: Partial<DashboardFilters>) =>
    onChange({ ...filters, ...patch });
  const filterable = Object.values(questions).filter(
    (q) =>
      isChoiceType(q.type) || q.type === "rating" || q.type === "linear_scale",
  );

  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (filters.range !== "all") {
    const value =
      filters.range === "custom"
        ? `${filters.from} – ${filters.to ?? "…"}`
        : t(`ranges.${filters.range}`);
    chips.push({
      key: "range",
      label: t("chipRange", { value }),
      remove: () => set({ range: "all", from: undefined, to: undefined }),
    });
  }
  for (const id of filters.versionIds) {
    const v = versions.find((x) => x.id === id);
    chips.push({
      key: `v:${id}`,
      label: t("chipVersion", { value: v?.number ?? "?" }),
      remove: () =>
        set({ versionIds: filters.versionIds.filter((x) => x !== id) }),
    });
  }
  for (const a of filters.answers) {
    const q = questions[a.questionKey];
    const values = a.values
      .map((v) =>
        q && isChoiceType(q.type) ? optionLabel(a.questionKey, v) : v,
      )
      .join(", ");
    chips.push({
      key: `a:${a.questionKey}`,
      label: t("chipAnswer", { question: q?.title ?? a.questionKey, values }),
      remove: () =>
        set({
          answers: filters.answers.filter(
            (x) => x.questionKey !== a.questionKey,
          ),
        }),
    });
  }
  if (filters.device)
    chips.push({
      key: "device",
      label: t("chipDevice", { value: deviceLabel(filters.device) }),
      remove: () => set({ device: undefined }),
    });
  if (filters.locale)
    chips.push({
      key: "lang",
      label: t("chipLanguage", { value: languageLabel(filters.locale) }),
      remove: () => set({ locale: undefined }),
    });

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="filter-bar"
      data-no-export="true"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.range === "custom" ? "custom" : filters.range}
          onValueChange={(v) =>
            set(
              v === "custom"
                ? {
                    range: "custom",
                    from: filters.from ?? todayIso(-6),
                    to: filters.to ?? todayIso(0),
                  }
                : {
                    range: v as DashboardFilters["range"],
                    from: undefined,
                    to: undefined,
                  },
            )
          }
        >
          <SelectTrigger className="w-40" aria-label={t("range")}>
            <SelectValue>{t(`ranges.${filters.range}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[...DATE_PRESETS, "custom" as const].map((r) => (
              <SelectItem key={r} value={r}>
                {t(`ranges.${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.range === "custom" && (
          <div className="flex items-center gap-1">
            <Input
              type="date"
              className="w-40"
              aria-label={t("from")}
              value={filters.from ?? ""}
              onChange={(e) => e.target.value && set({ from: e.target.value })}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              className="w-40"
              aria-label={t("to")}
              value={filters.to ?? ""}
              onChange={(e) => set({ to: e.target.value || undefined })}
            />
          </div>
        )}
        {versions.length > 1 && (
          <Select
            value={filters.versionIds[0] ?? ALL}
            onValueChange={(v) => set({ versionIds: v === ALL ? [] : [v] })}
          >
            <SelectTrigger className="w-36" aria-label={t("version")}>
              <SelectValue>
                {filters.versionIds[0]
                  ? t("versionN", {
                      number:
                        versions.find((x) => x.id === filters.versionIds[0])
                          ?.number ?? "?",
                    })
                  : t("allVersions")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("allVersions")}</SelectItem>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {t("versionN", { number: v.number })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={filters.device ?? ALL}
          onValueChange={(v) => set({ device: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-36" aria-label={t("device")}>
            <SelectValue>
              {filters.device ? deviceLabel(filters.device) : t("allDevices")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allDevices")}</SelectItem>
            {["mobile", "desktop", "tablet"].map((d) => (
              <SelectItem key={d} value={d}>
                {deviceLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.locale ?? ALL}
          onValueChange={(v) => set({ locale: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-40" aria-label={t("language")}>
            <SelectValue>
              {filters.locale
                ? languageLabel(filters.locale)
                : t("allLanguages")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allLanguages")}</SelectItem>
            {["id", "en"].map((l) => (
              <SelectItem key={l} value={l}>
                {languageLabel(l)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AnswerFilterPopover
          questions={filterable}
          optionLabel={optionLabel}
          onAdd={(questionKey, values) =>
            set({
              answers: [
                ...filters.answers.filter((a) => a.questionKey !== questionKey),
                { questionKey, values },
              ],
            })
          }
        />
        {showCompare && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={filters.compare}
              disabled={filters.range === "all"}
              onCheckedChange={(compare) => set({ compare })}
              aria-label={t("compare")}
            />
            <span className="hidden text-muted-foreground lg:inline">
              {t("compare")}
            </span>
          </label>
        )}
      </div>
      {chips.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={t("label")}
        >
          {chips.map((chip) => (
            <Badge
              key={chip.key}
              variant="secondary"
              className="gap-1 pr-1 font-normal"
              data-testid="filter-chip"
            >
              <span className="max-w-64 truncate">{chip.label}</span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                aria-label={t("remove", { name: chip.label })}
                onClick={chip.remove}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
          {hasActiveFilters(filters) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6"
              onClick={() =>
                onChange({ ...EMPTY_FILTERS, compare: filters.compare })
              }
            >
              {t("clearAll")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function todayIso(offsetDays: number): string {
  const d = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function AnswerFilterPopover({
  questions,
  optionLabel,
  onAdd,
}: {
  questions: Question[];
  optionLabel: (questionKey: string, optionId: string) => string;
  onAdd: (questionKey: string, values: string[]) => void;
}) {
  const t = useTranslations("filters");
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string>("");
  const [values, setValues] = useState<string[]>([]);
  const question = questions.find((q) => q.key === key);
  const choices: { id: string; label: string }[] = !question
    ? []
    : isChoiceType(question.type)
      ? [
          ...(question.options ?? []).map((o) => ({
            id: o.id,
            label: o.label,
          })),
          ...(question.allowOther
            ? [
                {
                  id: OTHER_OPTION_ID,
                  label: optionLabel(question.key, OTHER_OPTION_ID),
                },
              ]
            : []),
        ]
      : range(question).map((v) => ({ id: String(v), label: String(v) }));

  if (!questions.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Filter aria-hidden />
          {t("addAnswerFilter")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>{t("question")}</Label>
          <Select
            value={key}
            onValueChange={(v) => {
              setKey(v);
              setValues([]);
            }}
          >
            <SelectTrigger className="w-full" aria-label={t("question")}>
              <SelectValue placeholder={t("question")} />
            </SelectTrigger>
            <SelectContent>
              {questions.map((q) => (
                <SelectItem key={q.key} value={q.key}>
                  <span className="line-clamp-1">{q.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {question && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("values")}</Label>
            <div className="flex max-h-48 flex-col gap-1 overflow-auto">
              {choices.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={values.includes(c.id)}
                    onCheckedChange={(checked) =>
                      setValues((v) =>
                        checked ? [...v, c.id] : v.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
        <Button
          size="sm"
          disabled={!question || !values.length}
          onClick={() => {
            onAdd(key, values);
            setOpen(false);
            setKey("");
            setValues([]);
          }}
        >
          {t("apply")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function range(q: Question): number[] {
  const min = q.type === "linear_scale" ? (q.scale?.min ?? 1) : 1;
  const max =
    q.type === "linear_scale" ? (q.scale?.max ?? 5) : (q.rating?.max ?? 5);
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
