import type { NextRequest } from "next/server";
import { cleanNotes, missingNotes, qcFlags, quotaCell } from "@/lib/forms/capi";
import {
  MAX_INTERVIEW_BYTES,
  MAX_OFFLINE_AGE_MS,
  interviewPayloadSchema,
  type InterviewErrorCode,
  type InterviewResult,
} from "@/lib/forms/interview";
import {
  extractPhotos,
  interviewDefinition,
  interviewer,
  loadInterviewForm,
  withoutPhotos,
} from "@/lib/forms/interview-server";
import { computeFlow, type Answers } from "@/lib/forms/logic";
import { isPastDeadline } from "@/lib/forms/public";
import {
  detectDevice,
  durationSeconds,
  prepareAnswers,
} from "@/lib/forms/submission";
import { createAdminClient } from "@/lib/supabase/admin";

// Interviews by signed-in surveyors. The session is checked here; writes go
// through submit_response / record_screenout with the secret key.
export const dynamic = "force-dynamic";

const STATUS: Record<InterviewErrorCode, number> = {
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_CAPI: 409,
  FORM_CLOSED: 410,
  INVALID_VERSION: 409,
  VALIDATION_ERROR: 422,
  NOTES_REQUIRED: 422,
  QUOTA_AVAILABLE: 409,
  SERVER_ERROR: 500,
};

function json(body: InterviewResult, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function fail(
  code: InterviewErrorCode,
  extra: Partial<Extract<InterviewResult, { ok: false }>> = {},
) {
  return json({ ok: false, code, ...extra }, STATUS[code]);
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/interviews/[id]/submit">,
) {
  const { id } = await ctx.params;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_INTERVIEW_BYTES) return fail("PAYLOAD_TOO_LARGE");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_INTERVIEW_BYTES)
    return fail("PAYLOAD_TOO_LARGE");

  const user = await interviewer(id);
  if (!user) {
    const form = await loadInterviewForm(id);
    return fail(form ? "UNAUTHORIZED" : "NOT_FOUND");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return fail("BAD_REQUEST");
  }
  const parsed = interviewPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) return fail("BAD_REQUEST");
  const payload = parsed.data;

  const form = await loadInterviewForm(id);
  if (!form || !form.versionId) return fail("NOT_FOUND");
  if (!form.settings.enabled) return fail("NOT_CAPI");
  if (form.status !== "published" || isPastDeadline(form.deadlineAt))
    return fail("FORM_CLOSED");

  const definition = await interviewDefinition(form, payload.versionId);
  if (!definition) return fail("INVALID_VERSION");

  // Offline interviews keep their real end time (bounded).
  const now = Date.now();
  const finishedAt =
    payload.finishedAt <= now + 5 * 60_000 &&
    payload.finishedAt >= now - MAX_OFFLINE_AGE_MS
      ? payload.finishedAt
      : now;
  const duration = durationSeconds(payload.startedAt, finishedAt);
  const answers = payload.answers as Answers;
  const notes = cleanNotes(definition, payload.notes ?? {});
  const admin = createAdminClient();
  const common = {
    p_form_id: form.id,
    p_version_id: payload.versionId,
    p_submission_token: payload.submissionToken,
    p_duration_seconds: duration,
    p_locale: payload.locale,
    p_device: detectDevice(request.headers.get("user-agent")),
    p_surveyor_id: user.id,
    p_submitted_at: new Date(finishedAt).toISOString(),
  };

  // Quota screen-out (the live check found the cell full): verify, then keep it.
  if (payload.screenOut === "quota") {
    const cell = quotaCell(form.settings, answers);
    const quota = form.settings.quota;
    const { data: count } = cell
      ? await admin.rpc("quota_count", { p_form_id: form.id, p_cell: cell })
      : { data: null };
    if (!cell || !quota.enabled || (count ?? 0) < quota.target + quota.reserve)
      return fail("QUOTA_AVAILABLE");
    const { error } = await admin.rpc("record_screenout", {
      ...common,
      p_kind: "quota",
      p_question_key: quota.checkAfter ?? undefined,
      p_reason: cell,
      p_answers: withoutPhotos(definition, answers) as never,
      p_notes: notes,
      p_quota_cell: cell,
    });
    if (error) return fail("SERVER_ERROR");
    return json({
      ok: true,
      status: "screened_out",
      kind: "quota",
      code: cell,
    });
  }

  // Screen-out: answers up to the terminating question are kept for QC.
  const flow = computeFlow(definition, answers);
  if (flow.terminated) {
    const visible = new Set(flow.visible.map((q) => q.key));
    const kept = Object.fromEntries(
      Object.entries(withoutPhotos(definition, answers)).filter(([k]) =>
        visible.has(k),
      ),
    );
    const { error } = await admin.rpc("record_screenout", {
      ...common,
      p_kind: "rule",
      p_question_key: flow.terminated.questionKey,
      p_question_code: flow.terminated.code ?? undefined,
      p_reason: flow.terminated.reason ?? undefined,
      p_answers: kept as never,
      p_notes: notes,
      p_quota_cell: quotaCell(form.settings, kept) ?? undefined,
    });
    if (error) {
      console.error("record_screenout failed", error.code);
      return fail("SERVER_ERROR");
    }
    return json({
      ok: true,
      status: "screened_out",
      kind: "rule",
      code: flow.terminated.code ?? null,
    });
  }

  const extracted = extractPhotos(definition, answers);
  if (!extracted) return fail("VALIDATION_ERROR", { errors: {} });
  const prepared = prepareAnswers(definition, answers, extracted.photoIds);
  if (!prepared.ok)
    return fail("VALIDATION_ERROR", { errors: prepared.errors });

  if (form.settings.notes) {
    const missing = missingNotes(
      definition,
      flow.visible.map((q) => q.key),
      notes,
    );
    if (missing.length) return fail("NOTES_REQUIRED", { notes: missing });
  }

  const cell = quotaCell(form.settings, prepared.answers);
  const quota = form.settings.quota;
  const { data, error } = await admin
    .rpc("submit_response", {
      ...common,
      p_answers: prepared.rows,
      p_notes: notes,
      p_quota_cell: cell ?? undefined,
      p_quota_target: cell && quota.enabled ? quota.target : undefined,
      p_quota_reserve: cell && quota.enabled ? quota.reserve : undefined,
      p_id_digits:
        cell && form.settings.respondentId.enabled
          ? form.settings.respondentId.digits
          : undefined,
      p_qc_flags: qcFlags(
        form.settings,
        definition,
        prepared.answers,
        duration,
      ),
      p_photos: extracted.photos.length ? extracted.photos : undefined,
    })
    .single();

  if (error || !data) {
    if (error?.code === "P0001" && error.message === "QUOTA_FULL") {
      const { error: soError } = await admin.rpc("record_screenout", {
        ...common,
        p_kind: "quota",
        p_question_key: form.settings.quota.checkAfter ?? undefined,
        p_reason: cell ?? undefined,
        p_answers: withoutPhotos(definition, prepared.answers) as never,
        p_notes: notes,
        p_quota_cell: cell ?? undefined,
      });
      if (soError) return fail("SERVER_ERROR");
      return json({
        ok: true,
        status: "screened_out",
        kind: "quota",
        code: cell,
      });
    }
    if (error?.code === "P0001" && error.message === "FORM_CLOSED")
      return fail("FORM_CLOSED");
    if (error?.code === "P0001" && error.message === "INVALID_VERSION")
      return fail("INVALID_VERSION");
    if (error?.code === "P0001" && error.message === "INVALID_ANSWERS")
      return fail("VALIDATION_ERROR", { errors: {} });
    console.error("submit_response (interview) failed", error?.code);
    return fail("SERVER_ERROR");
  }

  return json({
    ok: true,
    status: "complete",
    responseId: data.response_id,
    respondentCode: data.respondent_code,
    ...(data.replayed ? { replayed: true } : {}),
  });
}
