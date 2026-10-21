import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";
import { parseCapiSettings } from "@/lib/forms/capi";
import { buildIdentifier } from "@/lib/forms/identifier";
import { extractPhotos, withoutPhotos } from "@/lib/forms/interview-server";
import { computeFlow, type Answers } from "@/lib/forms/logic";
import {
  findFormForRespondent,
  isPastDeadline,
  loadVersionDefinition,
} from "@/lib/forms/public";
import { flattenQuestions } from "@/lib/forms/schema";
import {
  MAX_PAYLOAD_BYTES,
  MAX_PHOTO_PAYLOAD_BYTES,
  MIN_FILL_MS,
  detectDevice,
  durationSeconds,
  prepareAnswers,
  submitPayloadSchema,
  type SubmitErrorCode,
  type SubmitResponse,
} from "@/lib/forms/submission";
import { routing, type Locale } from "@/lib/i18n/routing";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  hashIp,
} from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// Public endpoint (no auth). Respondents never talk to Supabase directly.
export const dynamic = "force-dynamic";

const STATUS: Record<SubmitErrorCode, number> = {
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  TOO_FAST: 422,
  NOT_FOUND: 404,
  FORM_CLOSED: 410,
  INVALID_VERSION: 409,
  IDENTIFIER_INVALID: 422,
  VALIDATION_ERROR: 422,
  ALREADY_SUBMITTED: 409,
  SERVER_ERROR: 500,
};

async function fail(
  code: SubmitErrorCode,
  locale: Locale,
  extra: Partial<Extract<SubmitResponse, { ok: false }>> = {},
) {
  const t = await getTranslations({
    locale,
    namespace: "publicForm.submitErrors",
  });
  const body: SubmitResponse = { ok: false, code, message: t(code), ...extra };
  return Response.json(body, {
    status: STATUS[code],
    headers: { "Cache-Control": "no-store" },
  });
}

function ok(responseId: string, replayed = false, screenedOut = false) {
  const body: SubmitResponse = {
    ok: true,
    responseId,
    ...(replayed ? { replayed } : {}),
    ...(screenedOut ? { screenedOut } : {}),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function localeFromHeaders(request: NextRequest): Locale {
  const lang = request.headers.get("accept-language")?.slice(0, 2);
  return (routing.locales as readonly string[]).includes(lang ?? "")
    ? (lang as Locale)
    : routing.defaultLocale;
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/f/[slug]/submit">,
) {
  const { slug } = await ctx.params;
  let locale = localeFromHeaders(request);
  const admin = createAdminClient();

  // 1. Rate limit (per IP + form, and per IP globally). Only salted hashes are stored.
  const ip = getClientIp(request.headers);
  const [perForm, global] = await Promise.all([
    checkRateLimit(
      admin,
      `submit:form:${hashIp(ip, slug)}`,
      RATE_LIMITS.submitPerForm,
    ),
    checkRateLimit(admin, `submit:ip:${hashIp(ip)}`, RATE_LIMITS.submitGlobal),
  ]);
  if (!perForm || !global) return fail("RATE_LIMITED", locale);

  // Size limit before parsing (100 KB; 8 MB for forms with photos, checked below).
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PHOTO_PAYLOAD_BYTES)
    return fail("PAYLOAD_TOO_LARGE", locale);
  const raw = await request.text();
  const rawBytes = Buffer.byteLength(raw, "utf8");
  if (rawBytes > MAX_PHOTO_PAYLOAD_BYTES)
    return fail("PAYLOAD_TOO_LARGE", locale);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("BAD_REQUEST", locale);
  }
  const parsed = submitPayloadSchema.safeParse(json);
  if (!parsed.success) return fail("BAD_REQUEST", locale);
  const payload = parsed.data;
  locale = payload.locale;

  // 2. Anti-spam. Honeypot: pretend success and drop it.
  if (payload.honeypot) return ok(randomUUID());
  const now = Date.now();

  // 3. Form must exist and be open (server is authoritative).
  const form = await findFormForRespondent(slug);
  if (!form || !form.current_version_id || form.status === "draft")
    return fail("NOT_FOUND", locale);
  // Interview-only forms are filled by signed-in surveyors (/api/interviews).
  if (parseCapiSettings(form.capi_settings).enabled)
    return fail("NOT_FOUND", locale);

  // Idempotent replay: a retried request with the same token gets the original answer.
  const { data: existing } = await admin
    .from("responses")
    .select("id")
    .eq("form_id", form.id)
    .eq("submission_token", payload.submissionToken)
    .maybeSingle();
  if (existing) return ok(existing.id, true);

  if (form.status !== "published" || isPastDeadline(form.deadline_at, now))
    return fail("FORM_CLOSED", locale);

  // 4. The version must belong to this form; validate against THAT version.
  const definition = await loadVersionDefinition(form.id, payload.versionId);
  if (!definition) return fail("INVALID_VERSION", locale);

  const hasPhotos = flattenQuestions(definition).some(
    (q) => q.type === "photo",
  );
  if (!hasPhotos && rawBytes > MAX_PAYLOAD_BYTES)
    return fail("PAYLOAD_TOO_LARGE", locale);

  // A screening rule ended the form: keep the answers so far as a screen-out.
  const answers = payload.answers as Answers;
  const flow = computeFlow(definition, answers);
  if (flow.terminated) {
    const visible = new Set(flow.visible.map((q) => q.key));
    const { data: screenoutId, error: soError } = await admin.rpc(
      "record_screenout",
      {
        p_form_id: form.id,
        p_version_id: payload.versionId,
        p_submission_token: payload.submissionToken,
        p_kind: "rule",
        p_question_key: flow.terminated.questionKey,
        p_question_code: flow.terminated.code ?? undefined,
        p_reason: flow.terminated.reason ?? undefined,
        p_answers: Object.fromEntries(
          Object.entries(withoutPhotos(definition, answers)).filter(([k]) =>
            visible.has(k),
          ),
        ) as never,
        p_duration_seconds: durationSeconds(payload.startedAt, now),
        p_locale: payload.locale,
        p_device: detectDevice(request.headers.get("user-agent")),
      },
    );
    if (soError || !screenoutId) return fail("SERVER_ERROR", locale);
    return ok(screenoutId, false, true);
  }

  // Too fast to be a person (screen-outs above may legitimately end in seconds).
  if (now - payload.startedAt < MIN_FILL_MS) return fail("TOO_FAST", locale);

  // 5. Validate: hidden questions and unknown keys are dropped; text capped.
  const photos = extractPhotos(definition, answers);
  if (!photos) return fail("VALIDATION_ERROR", locale, { errors: {} });
  const prepared = prepareAnswers(definition, answers, photos.photoIds);
  if (!prepared.ok)
    return fail("VALIDATION_ERROR", locale, { errors: prepared.errors });

  // 6. Identifier (duplicates are checked atomically inside submit_response).
  const identifier = buildIdentifier(
    form.identifier_mode,
    payload.identifier ?? {},
  );
  if (!identifier.ok)
    return fail("IDENTIFIER_INVALID", locale, {
      identifierErrors: identifier.errors,
    });

  // 7–9. One transaction: response + typed answers, duplicate check, draft cleanup.
  const { data, error } = await admin
    .rpc("submit_response", {
      p_form_id: form.id,
      p_version_id: payload.versionId,
      p_submission_token: payload.submissionToken,
      p_answers: prepared.rows,
      p_identifier_email: identifier.identifier.email ?? undefined,
      p_identifier_phone: identifier.identifier.phone ?? undefined,
      p_identifier_key: identifier.identifier.key ?? undefined,
      p_duration_seconds: durationSeconds(payload.startedAt, now),
      p_locale: payload.locale,
      p_device: detectDevice(request.headers.get("user-agent")),
      p_draft_token: payload.draftToken ?? undefined,
      p_photos: photos.photos.length ? photos.photos : undefined,
    })
    .single();

  if (error || !data) {
    const known: Record<string, SubmitErrorCode> = {
      ALREADY_SUBMITTED: "ALREADY_SUBMITTED",
      FORM_CLOSED: "FORM_CLOSED",
      FORM_NOT_FOUND: "NOT_FOUND",
      INVALID_VERSION: "INVALID_VERSION",
      IDENTIFIER_REQUIRED: "IDENTIFIER_INVALID",
      INVALID_ANSWERS: "VALIDATION_ERROR",
    };
    const code =
      (error?.code === "P0001" && known[error.message]) ||
      (error?.code === "23505" ? "ALREADY_SUBMITTED" : null);
    if (code) return fail(code, locale);
    console.error("submit_response failed", error?.code);
    return fail("SERVER_ERROR", locale);
  }

  return ok(data.response_id, data.replayed);
}
