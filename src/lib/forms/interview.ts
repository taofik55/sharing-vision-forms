/**
 * Interview (CAPI) submission contract, shared by the runner, the offline
 * outbox and the API route. Pure.
 */
import { z } from "zod";
import { routing } from "@/lib/i18n/routing";
import type { AnswerErrors } from "./validation";

/** Interviews may carry photos: 8 MB per request. */
export const MAX_INTERVIEW_BYTES = 8 * 1024 * 1024;
/** Offline interviews keep their real time if synced within two weeks. */
export const MAX_OFFLINE_AGE_MS = 14 * 24 * 3600 * 1000;

export const INTERVIEW_ERROR_CODES = [
  "BAD_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "NOT_CAPI",
  "FORM_CLOSED",
  "INVALID_VERSION",
  "VALIDATION_ERROR",
  "NOTES_REQUIRED",
  /** A quota screen-out was sent but the cell has room again. */
  "QUOTA_AVAILABLE",
  "SERVER_ERROR",
] as const;
export type InterviewErrorCode = (typeof INTERVIEW_ERROR_CODES)[number];

export const interviewPayloadSchema = z.object({
  versionId: z.uuid(),
  answers: z.record(z.string().max(64), z.unknown()),
  notes: z.record(z.string().max(64), z.string().max(2000)).optional(),
  submissionToken: z.uuid(),
  /** Epoch ms: interview start and end on the device. */
  startedAt: z.number().int().positive(),
  finishedAt: z.number().int().positive(),
  /** Seed for the random order of options and rows (stored for audit). */
  seed: z.string().max(64).optional(),
  /** The live quota check found the cell full: end as a quota screen-out. */
  screenOut: z.literal("quota").optional(),
  locale: z.enum(routing.locales).catch(routing.defaultLocale),
});
export type InterviewPayload = z.infer<typeof interviewPayloadSchema>;

export type InterviewResult =
  | {
      ok: true;
      status: "complete";
      responseId: string;
      respondentCode: string | null;
      replayed?: boolean;
    }
  | {
      ok: true;
      status: "screened_out";
      /** rule: a screening answer; quota: the quota cell was full. */
      kind: "rule" | "quota";
      code: string | null;
    }
  | {
      ok: false;
      code: InterviewErrorCode;
      errors?: AnswerErrors;
      /** Question keys whose required note is empty. */
      notes?: string[];
    };

export type QuotaStatus = {
  cell: string | null;
  count: number;
  target: number | null;
  reserve: number;
  full: boolean;
};

/** Errors that keep an interview in the outbox for a later retry. */
export function isRetryable(code: InterviewErrorCode | "NETWORK"): boolean {
  return (
    code === "NETWORK" || code === "SERVER_ERROR" || code === "UNAUTHORIZED"
  );
}
