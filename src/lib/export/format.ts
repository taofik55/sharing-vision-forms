/**
 * Pure helpers for response exports (CSV / XLSX): columns, cell values,
 * formula-injection guard and RFC 4180 CSV encoding.
 */
import type { QuestionStats } from "@/lib/analytics/types";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";

export type ExportAnswer = {
  /** Text (also "Other" free text and email / phone answers). */
  t?: string;
  n?: number;
  /** YYYY-MM-DD */
  d?: string;
  o?: string[];
};

/** One row of the export_responses RPC. */
export type ExportRow = {
  id: string;
  submitted_at: string;
  version_number: number;
  identifier_email: string | null;
  identifier_phone: string | null;
  answers: Record<string, ExportAnswer>;
};

export type ExportQuestion = Pick<Question, "key" | "type" | "title"> & {
  options?: { id: string; label: string }[];
};

export type ExportLabels = {
  responseId: string;
  submittedAtUtc: string;
  submittedAtLocal: string;
  version: string;
  identifierEmail: string;
  identifierPhone: string;
  other: string;
};

export type Cell = string | number | null;

export type ExportColumn = {
  header: string;
  /** Spreadsheet column width hint (characters). */
  width: number;
  value: (row: ExportRow) => Cell;
};

/** Question headers: latest title; the short key is appended when titles collide. */
export function questionHeaders(questions: ExportQuestion[]): string[] {
  const counts = new Map<string, number>();
  for (const q of questions) {
    const title = q.title.trim() || q.key;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const used = new Set<string>();
  return questions.map((q) => {
    const title = q.title.trim() || q.key;
    let header =
      (counts.get(title) ?? 0) > 1 ? `${title} [${q.key.slice(0, 6)}]` : title;
    if (used.has(header)) header = `${title} [${q.key}]`;
    used.add(header);
    return header;
  });
}

/** Answer as a cell: option labels, checkboxes joined with "; ", numbers as numbers. */
export function answerCell(
  question: ExportQuestion,
  answer: ExportAnswer | undefined,
  otherLabel: string,
): Cell {
  if (!answer) return null;
  switch (question.type) {
    case "multiple_choice":
    case "dropdown":
    case "checkboxes": {
      const labels = (answer.o ?? []).map((id) => {
        if (id === OTHER_OPTION_ID)
          return answer.t ? `${otherLabel}: ${answer.t}` : otherLabel;
        return question.options?.find((o) => o.id === id)?.label ?? id;
      });
      return labels.length ? labels.join("; ") : null;
    }
    case "rating":
    case "linear_scale":
    case "number":
      return typeof answer.n === "number" ? answer.n : null;
    case "date":
      return answer.d ?? null;
    default:
      return answer.t ?? null;
  }
}

const JAKARTA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "YYYY-MM-DD HH:mm:ss" in Asia/Jakarta (WIB). */
export function jakartaTime(iso: string): string {
  return JAKARTA.format(new Date(iso));
}

/** ISO 8601 in UTC with milliseconds, e.g. 2026-10-13T02:00:00.000Z. */
export function isoTime(iso: string): string {
  return new Date(iso).toISOString();
}

export function exportColumns(
  questions: ExportQuestion[],
  labels: ExportLabels,
  includeIdentifiers: boolean,
): ExportColumn[] {
  const columns: ExportColumn[] = [
    { header: labels.responseId, width: 38, value: (r) => r.id },
    {
      header: labels.submittedAtUtc,
      width: 26,
      value: (r) => isoTime(r.submitted_at),
    },
    {
      header: labels.submittedAtLocal,
      width: 21,
      value: (r) => jakartaTime(r.submitted_at),
    },
    { header: labels.version, width: 8, value: (r) => r.version_number },
  ];
  if (includeIdentifiers) {
    columns.push(
      {
        header: labels.identifierEmail,
        width: 28,
        value: (r) => r.identifier_email,
      },
      {
        header: labels.identifierPhone,
        width: 18,
        value: (r) => r.identifier_phone,
      },
    );
  }
  const headers = questionHeaders(questions);
  questions.forEach((q, i) => {
    columns.push({
      header: headers[i],
      width: Math.min(60, Math.max(12, headers[i].length + 2)),
      value: (r) => answerCell(q, r.answers[q.key], labels.other),
    });
  });
  return columns;
}

/**
 * Formula-injection guard (CSV / Excel): text starting with = + - @ (or a tab
 * / carriage return, which some spreadsheets strip first) is prefixed with a
 * single quote so it is shown as text. Numbers are left alone.
 */
export function sanitizeCell(value: Cell): Cell {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One RFC 4180 record (CRLF-terminated). */
export function csvRecord(values: Cell[]): string {
  return (
    values
      .map((value) => {
        const cell = sanitizeCell(value);
        if (cell === null) return "";
        const text = String(cell);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(",") + "\r\n"
  );
}

/** Byte order mark so Excel opens UTF-8 CSV files correctly. */
export const UTF8_BOM = "﻿";

export type SummaryLabels = {
  question: string;
  type: string;
  answered: string;
  value: string;
  count: string;
  percent: string;
  total: string;
  mean: string;
  median: string;
  min: string;
  max: string;
  averageLength: string;
  other: string;
  typeLabel: (type: Question["type"]) => string;
};

const pct = (count: number, n: number) =>
  n > 0 ? Math.round((1000 * count) / n) / 10 : null;

/**
 * "Summary" sheet: per-question counts from the same aggregation as the
 * dashboard (dashboard_bundle), so both always agree.
 */
export function summaryRows(
  questions: ExportQuestion[],
  stats: Record<string, QuestionStats>,
  total: number,
  labels: SummaryLabels,
): Cell[][] {
  const rows: Cell[][] = [
    [labels.total, null, total, null, null, null],
    [],
    [
      labels.question,
      labels.type,
      labels.answered,
      labels.value,
      labels.count,
      labels.percent,
    ],
  ];
  const optionLabel = (q: ExportQuestion, id: string) =>
    id === OTHER_OPTION_ID
      ? labels.other
      : (q.options?.find((o) => o.id === id)?.label ?? id);

  for (const q of questions) {
    const s = stats[q.key];
    const n = s?.n ?? 0;
    rows.push([q.title, labels.typeLabel(q.type), n, null, null, null]);
    if (!s) continue;
    const detail = (value: Cell, count: Cell, percent: Cell = null) =>
      rows.push([null, null, null, value, count, percent]);
    switch (s.type) {
      case "multiple_choice":
      case "dropdown":
      case "checkboxes":
        for (const o of s.options)
          detail(optionLabel(q, o.id), o.count, pct(o.count, n));
        break;
      case "rating":
      case "linear_scale":
        for (const d of s.distribution)
          detail(d.value, d.count, pct(d.count, n));
        detail(labels.mean, s.mean);
        detail(labels.median, s.median);
        break;
      case "number":
        detail(labels.mean, s.mean);
        detail(labels.median, s.median);
        detail(labels.min, s.min);
        detail(labels.max, s.max);
        break;
      case "date":
        detail(labels.min, s.min);
        detail(labels.max, s.max);
        break;
      case "short_text":
      case "paragraph":
        detail(labels.averageLength, s.avg_length);
        break;
    }
  }
  return rows;
}

/** Safe download name: "<title>-responses-<YYYY-MM-DD>.<ext>". */
export function exportFileName(
  title: string,
  ext: "csv" | "xlsx",
  now = new Date(),
): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "form";
  return `${base}-responses-${jakartaTime(now.toISOString()).slice(0, 10)}.${ext}`;
}
