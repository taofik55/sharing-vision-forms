"use client";

import { useFormatter, useTranslations } from "next-intl";
import { createContext, useContext, useMemo } from "react";
import type { ChartSpec } from "@/lib/analytics/chart-spec";
import type { Widget } from "@/lib/analytics/config";
import type { DashboardFilters, RpcFilters } from "@/lib/analytics/filters";
import type { InsightFormat } from "@/lib/analytics/insights";
import type { DashboardBundle } from "@/lib/analytics/types";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";

export type DashboardContextValue = {
  formId: string;
  bundle: DashboardBundle | undefined;
  /** Latest definition of every question key ever published. */
  questions: Record<string, Question>;
  /** Keys present in the current version. */
  currentKeys: Set<string>;
  versionCount: number;
  filters: DashboardFilters;
  rpcFilters: RpcFilters;
  setFilters: (filters: DashboardFilters) => void;
  editMode: boolean;
  canEdit: boolean;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  removeWidget: (id: string) => void;
  addWidget: (
    widget: Omit<Widget, "layout"> & { layout?: Widget["layout"] },
  ) => void;
  /** Widget ids whose numbers just changed (live highlight). */
  flashing: Set<string>;
  /** Increments whenever fresh data arrives (dependent queries refetch). */
  dataVersion: number;
  presenting: boolean;
  /** Clicking chart marks adds answer / device / language filters. */
  drillDown: boolean;
  /** Free-text content (top terms, latest answers) may be shown. */
  textAnswers: boolean;
  /**
   * Opens the chart builder (editors only): edit a custom widget, or start a
   * new chart (optionally from a spec, e.g. "open in chart builder").
   */
  openBuilder: ((widget?: Widget, spec?: ChartSpec) => void) | null;
};

export const DashboardContext = createContext<DashboardContextValue | null>(
  null,
);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside the dashboard");
  return ctx;
}

/** Locale-aware formatting + label lookups shared by widgets and insights. */
export function useLabels() {
  const format = useFormatter();
  const t = useTranslations();
  const { questions } = useDashboard();

  return useMemo(() => {
    const optionLabel = (questionKey: string, optionId: string) => {
      if (optionId === OTHER_OPTION_ID) return t("widgets.other");
      const option = questions[questionKey]?.options?.find(
        (o) => o.id === optionId,
      );
      return option?.label || t("widgets.removedOption", { id: optionId });
    };
    const fmt: InsightFormat = {
      number: (value, digits = 0) =>
        format.number(value, { maximumFractionDigits: digits }),
      percent: (ratio) =>
        format.number(ratio, {
          style: "percent",
          maximumFractionDigits: ratio < 0.1 && ratio > 0 ? 1 : 0,
        }),
      option: optionLabel,
      weekday: (dow) => t(`weekdays.${dow}` as "weekdays.1"),
      questionTitle: (key) => questions[key]?.title ?? key,
    };
    const deviceLabel = (key: string) =>
      ["mobile", "desktop", "tablet"].includes(key)
        ? t(`devices.${key as "mobile"}`)
        : t("devices.unknown");
    const languageLabel = (key: string) =>
      key === "id" || key === "en"
        ? t(`languages.${key}`)
        : key || t("languages.unknown");
    const duration = (seconds: number | null | undefined) => {
      if (seconds === null || seconds === undefined) return "—";
      const s = Math.round(seconds);
      return s < 60
        ? t("responsesTab.seconds", { value: s })
        : t("responsesTab.minutes", { m: Math.floor(s / 60), s: s % 60 });
    };
    return {
      fmt,
      optionLabel,
      deviceLabel,
      languageLabel,
      duration,
      format,
      t,
    };
  }, [format, t, questions]);
}
