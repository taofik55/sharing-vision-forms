/**
 * Submission helpers shared by the public client and the submit route.
 * Pure (no I/O), unit-tested.
 */
import { z } from "zod";
import { routing } from "@/lib/i18n/routing";
import { gridRowKey, rankKey } from "./analysis";
import {
  isChoiceAnswer,
  isGridAnswer,
  isLocationAnswer,
  isPhotoAnswer,
  type Answers,
} from "./logic";
import {
  OTHER_OPTION_ID,
  flattenQuestions,
  isTextType,
  type FormDefinition,
  type QuestionType,
} from "./schema";
import { validateAnswers, type AnswerErrors } from "./validation";

export const MAX_PAYLOAD_BYTES = 100 * 1024;
/** Forms with a photo question accept larger requests. */
export const MAX_PHOTO_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 5000;
/** Faster than this after the form was opened = probably a bot. */
export const MIN_FILL_MS = 3000;

export const SUBMIT_ERROR_CODES = [
  "BAD_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "TOO_FAST",
  "NOT_FOUND",
  "FORM_CLOSED",
  "INVALID_VERSION",
  "IDENTIFIER_INVALID",
  "VALIDATION_ERROR",
  "ALREADY_SUBMITTED",
  "SERVER_ERROR",
] as const;
export type SubmitErrorCode = (typeof SUBMIT_ERROR_CODES)[number];

export type SubmitResponse =
  | {
      ok: true;
      responseId: string;
      replayed?: boolean;
      /** A screening rule ended the form (stored as a screen-out). */
      screenedOut?: boolean;
    }
  | {
      ok: false;
      code: SubmitErrorCode;
      message: string;
      errors?: AnswerErrors;
      identifierErrors?: Record<string, string>;
    };

export const submitPayloadSchema = z.object({
  versionId: z.uuid(),
  answers: z.record(z.string().max(64), z.unknown()),
  identifier: z
    .object({
      email: z.string().max(320).nullish(),
      phone: z.string().max(40).nullish(),
    })
    .nullish(),
  draftToken: z.uuid().nullish(),
  submissionToken: z.uuid(),
  /** Epoch milliseconds when the respondent started. */
  startedAt: z.number().int().positive(),
  honeypot: z.string().max(1000).nullish(),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
});
export type SubmitPayload = z.infer<typeof submitPayloadSchema>;

export const draftPayloadSchema = z.object({
  draftToken: z.uuid(),
  versionId: z.uuid(),
  data: z.object({
    answers: z.record(z.string().max(64), z.unknown()),
    sectionId: z.string().max(64).nullish(),
    startedAt: z.number().int().positive().nullish(),
  }),
});

/** Row shape for response_answers (typed columns). */
export type AnswerRow = {
  question_key: string;
  /** Analysis type (grid rows are stored as multiple_choice / checkboxes). */
  question_type: QuestionType;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_options: string[] | null;
  /** location: { lat, lng, accuracy }; photo: { photoId }. */
  value_json?: Record<string, number | string> | null;
};

/** Photo answers are stored separately; the row keeps the photo id. */
export type PhotoIds = Record<string, string>;

/**
 * Maps validated answers to typed columns:
 * - text types -> value_text
 * - number, rating, linear_scale -> value_number
 * - date -> value_date (midnight UTC of that day)
 * - multiple_choice / dropdown -> value_options (one option id)
 * - checkboxes -> value_options (many option ids)
 * - "Other" free text -> value_text (alongside value_options)
 * - grid -> one row per answered grid row (key__row, multiple_choice / checkboxes)
 * - ranking -> the ordered ids (checkboxes) + one row per position (key__rN)
 * - location -> value_json { lat, lng, accuracy }; photo -> value_json { photoId }
 * Option IDs are stored, never labels.
 */
export function toAnswerRows(
  definition: FormDefinition,
  answers: Answers,
  photoIds: PhotoIds = {},
): AnswerRow[] {
  const rows: AnswerRow[] = [];
  const empty = {
    value_text: null,
    value_number: null,
    value_date: null,
    value_options: null,
  };
  for (const q of flattenQuestions(definition)) {
    const value = answers[q.key];
    if (value === undefined) continue;
    if (q.type === "grid") {
      if (!isGridAnswer(value)) continue;
      for (const [rowId, cols] of Object.entries(value.rows)) {
        if (!cols.length) continue;
        rows.push({
          ...empty,
          question_key: gridRowKey(q.key, rowId),
          question_type: q.grid?.multiple ? "checkboxes" : "multiple_choice",
          value_options: cols,
        });
      }
      continue;
    }
    if (q.type === "ranking") {
      if (!isChoiceAnswer(value)) continue;
      const otherText = value.selected.includes(OTHER_OPTION_ID)
        ? (value.otherText ?? null)
        : null;
      rows.push({
        ...empty,
        question_key: q.key,
        question_type: "checkboxes",
        value_options: value.selected,
        value_text: otherText,
      });
      value.selected.forEach((id, i) =>
        rows.push({
          ...empty,
          question_key: rankKey(q.key, i + 1),
          question_type: "multiple_choice",
          value_options: [id],
          value_text: id === OTHER_OPTION_ID ? otherText : null,
        }),
      );
      continue;
    }
    if (q.type === "location") {
      if (!isLocationAnswer(value)) continue;
      rows.push({
        ...empty,
        question_key: q.key,
        question_type: "location",
        value_json: {
          lat: value.lat,
          lng: value.lng,
          ...(value.accuracy !== undefined ? { accuracy: value.accuracy } : {}),
        },
      });
      continue;
    }
    if (q.type === "photo") {
      const id = photoIds[q.key];
      if (!isPhotoAnswer(value) || !id) continue;
      rows.push({
        ...empty,
        question_key: q.key,
        question_type: "photo",
        value_json: { photoId: id },
      });
      continue;
    }
    const row: AnswerRow = {
      question_key: q.key,
      question_type: q.type,
      ...empty,
    };
    if (isTextType(q.type) && typeof value === "string") row.value_text = value;
    else if (
      (q.type === "number" ||
        q.type === "rating" ||
        q.type === "linear_scale") &&
      typeof value === "number"
    ) {
      row.value_number = value;
    } else if (q.type === "date" && typeof value === "string")
      row.value_date = `${value}T00:00:00.000Z`;
    else if (isChoiceAnswer(value)) {
      row.value_options = value.selected;
      if (value.selected.includes(OTHER_OPTION_ID) && value.otherText)
        row.value_text = value.otherText;
    } else continue;
    rows.push(row);
  }
  return rows;
}

/**
 * Validates answers against a version: hidden questions and unknown keys are
 * dropped, every visible answer must pass the shared answer schema.
 */
export function prepareAnswers(
  definition: FormDefinition,
  answers: Answers,
  photoIds: PhotoIds = {},
):
  | { ok: true; answers: Answers; rows: AnswerRow[] }
  | { ok: false; errors: AnswerErrors } {
  const result = validateAnswers(definition, answers);
  if (!result.ok) return result;
  // Defense in depth: no single text value may exceed the hard cap.
  const rows = toAnswerRows(definition, result.data, photoIds);
  const tooLong = rows.find(
    (r) => (r.value_text?.length ?? 0) > MAX_TEXT_LENGTH,
  );
  if (tooLong)
    return { ok: false, errors: { [tooLong.question_key]: "tooLong" } };
  return { ok: true, answers: result.data, rows };
}

export function detectDevice(
  userAgent: string | null,
): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!userAgent) return "unknown";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(userAgent))
    return "tablet";
  if (
    /mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(userAgent)
  )
    return "mobile";
  return "desktop";
}

/** Seconds between start and now, clamped to [0, 30 days]. */
export function durationSeconds(startedAt: number, now: number): number {
  return Math.max(
    0,
    Math.min(30 * 24 * 3600, Math.round((now - startedAt) / 1000)),
  );
}
