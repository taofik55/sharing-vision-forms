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
  /** location { lat, lng, accuracy } / photo { photoId } */
  j?: { lat?: number; lng?: number; accuracy?: number; photoId?: string };
};

/** One row of the export_responses RPC. */
export type ExportRow = {
  id: string;
  submitted_at: string;
  version_number: number;
  identifier_email: string | null;
  identifier_phone: string | null;
  respondent_code?: string | null;
  surveyor?: string | null;
  quota_cell?: string | null;
  qc_status?: string | null;
  duration_seconds?: number | null;
  /** Interviewer notes by question key. */
  notes?: Record<string, string> | null;
  answers: Record<string, ExportAnswer>;
};

export type ExportQuestion = Pick<Question, "key" | "type" | "title"> & {
  code?: string;
  options?: { id: string; label: string; code?: string }[];
};

export type ExportLabels = {
  responseId: string;
  submittedAtUtc: string;
  submittedAtLocal: string;
  version: string;
  identifierEmail: string;
  identifierPhone: string;
  other: string;
  respondentCode?: string;
  surveyor?: string;
  quotaCell?: string;
  qcStatus?: string;
  duration?: string;
  notes?: string;
  latitude?: string;
  longitude?: string;
};

export type ExportOptions = {
  /** Interview columns (respondent ID, surveyor, quota cell, QC, notes). */
  interview?: boolean;
  /** Option answer codes (1, 2, 99) instead of labels. */
  codes?: boolean;
  /** Absolute base URL for photo links. */
  baseUrl?: string;
};

export type Cell = string | number | null;

export type ExportColumn = {
  header: string;
  /** Spreadsheet column width hint (characters). */
  width: number;
  value: (row: ExportRow) => Cell;
};

/** Question headers: "S1. Title"; the short key is appended when titles collide. */
export function questionHeaders(questions: ExportQuestion[]): string[] {
  const counts = new Map<string, number>();
  const titleOf = (q: ExportQuestion) =>
    `${q.code ? `${q.code}. ` : ""}${q.title.trim() || q.key}`;
  for (const q of questions) {
    const title = titleOf(q);
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const used = new Set<string>();
  return questions.map((q) => {
    const title = titleOf(q);
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
  options: ExportOptions = {},
): Cell {
  if (!answer) return null;
  switch (question.type) {
    case "multiple_choice":
    case "dropdown":
    case "checkboxes":
    case "ranking": {
      const labels = (answer.o ?? []).map((id) => {
        if (id === OTHER_OPTION_ID)
          return answer.t ? `${otherLabel}: ${answer.t}` : otherLabel;
        const option = question.options?.find((o) => o.id === id);
        if (options.codes && option?.code) return option.code;
        return option?.label ?? id;
      });
      if (!labels.length) return null;
      // A single code stays a number for statistics packages.
      if (options.codes && labels.length === 1 && /^-?\d+$/.test(labels[0]))
        return Number(labels[0]);
      return labels.join("; ");
    }
    case "photo":
      return answer.j?.photoId
        ? `${options.baseUrl ?? ""}/api/photos/${answer.j.photoId}`
        : null;
    case "location":
      return answer.j?.lat !== undefined
        ? `${answer.j.lat}, ${answer.j.lng}`
        : null;
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
  options: ExportOptions = {},
): ExportColumn[] {
  const columns: ExportColumn[] = [
    { header: labels.responseId, width: 38, value: (r) => r.id },
    ...(options.interview
      ? ([
          {
            header: labels.respondentCode ?? "respondent_code",
            width: 14,
            value: (r) => r.respondent_code ?? null,
          },
          {
            header: labels.surveyor ?? "surveyor",
            width: 22,
            value: (r) => r.surveyor ?? null,
          },
          {
            header: labels.quotaCell ?? "quota_cell",
            width: 12,
            value: (r) => r.quota_cell ?? null,
          },
          {
            header: labels.qcStatus ?? "qc_status",
            width: 12,
            value: (r) => r.qc_status ?? null,
          },
          {
            header: labels.duration ?? "duration_seconds",
            width: 10,
            value: (r) => r.duration_seconds ?? null,
          },
        ] satisfies ExportColumn[])
      : []),
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
    if (q.type === "location") {
      columns.push(
        {
          header: `${headers[i]} (${labels.latitude ?? "lat"})`,
          width: 14,
          value: (r) => r.answers[q.key]?.j?.lat ?? null,
        },
        {
          header: `${headers[i]} (${labels.longitude ?? "lng"})`,
          width: 14,
          value: (r) => r.answers[q.key]?.j?.lng ?? null,
        },
      );
      return;
    }
    columns.push({
      header: headers[i],
      width: Math.min(60, Math.max(12, headers[i].length + 2)),
      value: (r) => answerCell(q, r.answers[q.key], labels.other, options),
    });
  });
  if (options.interview)
    columns.push({
      header: labels.notes ?? "notes",
      width: 50,
      value: (r) => {
        const notes = Object.entries(r.notes ?? {});
        if (!notes.length) return null;
        const codeOf = new Map(questions.map((q) => [q.key, q.code ?? q.key]));
        return notes.map(([k, v]) => `${codeOf.get(k) ?? k}: ${v}`).join(" | ");
      },
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
