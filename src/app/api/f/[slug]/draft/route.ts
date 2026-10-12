import type { NextRequest } from "next/server";
import { z } from "zod";
import { findFormForRespondent, isPastDeadline } from "@/lib/forms/public";
import { MAX_PAYLOAD_BYTES, draftPayloadSchema } from "@/lib/forms/submission";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  hashIp,
} from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

// Public endpoint (no auth): respondent drafts, keyed by an unguessable
// client-generated token. Drafts never contain the identifier.
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function openForm(slug: string) {
  const form = await findFormForRespondent(slug);
  if (!form || form.status !== "published" || isPastDeadline(form.deadline_at))
    return null;
  return form;
}

async function limited(request: NextRequest) {
  const ip = getClientIp(request.headers);
  return !(await checkRateLimit(
    createAdminClient(),
    `draft:ip:${hashIp(ip)}`,
    RATE_LIMITS.draft,
  ));
}

/** Upsert the draft (expires 30 days after the last save). */
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/f/[slug]/draft">,
) {
  const { slug } = await ctx.params;
  if (await limited(request))
    return json({ ok: false, code: "RATE_LIMITED" }, 429);

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_PAYLOAD_BYTES)
    return json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, code: "BAD_REQUEST" }, 400);
  }
  const parsed = draftPayloadSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, code: "BAD_REQUEST" }, 400);

  const form = await openForm(slug);
  if (!form) return json({ ok: false, code: "NOT_FOUND" }, 404);

  const { error } = await createAdminClient().rpc("save_response_draft", {
    p_form_id: form.id,
    p_draft_token: parsed.data.draftToken,
    p_version_id: parsed.data.versionId,
    p_data: parsed.data.data as unknown as Json,
  });
  if (error) {
    if (error.message === "INVALID_VERSION")
      return json({ ok: false, code: "INVALID_VERSION" }, 409);
    return json({ ok: false, code: "SERVER_ERROR" }, 500);
  }
  return json({ ok: true });
}

const tokenSchema = z.uuid();

/** Read a draft by token (same device only; the token lives in localStorage). */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/f/[slug]/draft">,
) {
  const { slug } = await ctx.params;
  if (await limited(request))
    return json({ ok: false, code: "RATE_LIMITED" }, 429);
  const token = tokenSchema.safeParse(
    request.nextUrl.searchParams.get("token"),
  );
  if (!token.success) return json({ ok: false, code: "BAD_REQUEST" }, 400);
  const form = await findFormForRespondent(slug);
  if (!form) return json({ ok: false, code: "NOT_FOUND" }, 404);

  const { data } = await createAdminClient()
    .from("response_drafts")
    .select("version_id, data, updated_at")
    .eq("form_id", form.id)
    .eq("draft_token", token.data)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return json({ ok: false, code: "NOT_FOUND" }, 404);
  return json({
    ok: true,
    versionId: data.version_id,
    data: data.data,
    updatedAt: data.updated_at,
  });
}

/** "Start over": forget the server copy. */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/f/[slug]/draft">,
) {
  const { slug } = await ctx.params;
  if (await limited(request))
    return json({ ok: false, code: "RATE_LIMITED" }, 429);
  const token = tokenSchema.safeParse(
    request.nextUrl.searchParams.get("token"),
  );
  if (!token.success) return json({ ok: false, code: "BAD_REQUEST" }, 400);
  const form = await findFormForRespondent(slug);
  if (!form) return json({ ok: false, code: "NOT_FOUND" }, 404);
  await createAdminClient().rpc("delete_response_draft", {
    p_form_id: form.id,
    p_draft_token: token.data,
  });
  return json({ ok: true });
}
