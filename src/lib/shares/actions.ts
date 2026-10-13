"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { routing, type Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { newShareToken, publicDashboardUrl, type ShareRow } from "./server";

// Dashboard share links. Every query runs as the signed-in user, so RLS
// (dashboard_shares: can_edit_form) decides who may list or change links.

export type ShareLink = {
  id: string;
  url: string;
  isActive: boolean;
  expiresAt: string | null;
  includeTextAnswers: boolean;
  createdAt: string;
};

export type ShareResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "notAllowed" | "invalidInput" | "generic" };

const uuid = z.uuid();
const expiry = z.iso.datetime({ offset: true }).nullable();

async function context() {
  const user = await getCurrentUser();
  if (!user?.isActive) return null;
  const locale = await getLocale();
  return {
    supabase: await createClient(),
    locale: ((routing.locales as readonly string[]).includes(locale)
      ? locale
      : routing.defaultLocale) as Locale,
    user,
  };
}

function toLink(row: ShareRow, locale: Locale): ShareLink {
  return {
    id: row.id,
    url: publicDashboardUrl(row.token, locale),
    isActive: row.is_active,
    expiresAt: row.expires_at,
    includeTextAnswers: row.include_text_answers,
    createdAt: row.created_at,
  };
}

export async function listSharesAction(
  formId: unknown,
): Promise<ShareResult<ShareLink[]>> {
  const ctx = await context();
  if (!ctx || !uuid.safeParse(formId).success)
    return { ok: false, error: "notAllowed" };
  const { data, error } = await ctx.supabase
    .from("dashboard_shares")
    .select("*")
    .eq("form_id", formId as string)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: "generic" };
  return { ok: true, data: data.map((row) => toLink(row, ctx.locale)) };
}

export async function createShareAction(
  input: unknown,
): Promise<ShareResult<ShareLink>> {
  const ctx = await context();
  const parsed = z
    .object({
      formId: uuid,
      expiresAt: expiry,
      includeTextAnswers: z.boolean(),
    })
    .safeParse(input);
  if (!ctx) return { ok: false, error: "notAllowed" };
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { data, error } = await ctx.supabase
    .from("dashboard_shares")
    .insert({
      form_id: parsed.data.formId,
      token: newShareToken(),
      expires_at: parsed.data.expiresAt,
      include_text_answers: parsed.data.includeTextAnswers,
      created_by: ctx.user.id,
    })
    .select("*")
    .single();
  // RLS rejects callers without edit rights (42501).
  if (error)
    return {
      ok: false,
      error: error.code === "42501" ? "notAllowed" : "generic",
    };
  return { ok: true, data: toLink(data, ctx.locale) };
}

export async function updateShareAction(
  input: unknown,
): Promise<ShareResult<ShareLink>> {
  const ctx = await context();
  const parsed = z
    .object({
      id: uuid,
      isActive: z.boolean().optional(),
      expiresAt: expiry.optional(),
      includeTextAnswers: z.boolean().optional(),
      regenerate: z.boolean().optional(),
    })
    .safeParse(input);
  if (!ctx) return { ok: false, error: "notAllowed" };
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { id, isActive, expiresAt, includeTextAnswers, regenerate } =
    parsed.data;
  const { data, error } = await ctx.supabase
    .from("dashboard_shares")
    .update({
      ...(isActive === undefined ? {} : { is_active: isActive }),
      ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
      ...(includeTextAnswers === undefined
        ? {}
        : { include_text_answers: includeTextAnswers }),
      // A new token invalidates the old URL immediately.
      ...(regenerate ? { token: newShareToken() } : {}),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: "generic" };
  if (!data) return { ok: false, error: "notAllowed" };
  return { ok: true, data: toLink(data, ctx.locale) };
}

export async function revokeShareAction(
  id: unknown,
): Promise<ShareResult<null>> {
  const ctx = await context();
  if (!ctx || !uuid.safeParse(id).success)
    return { ok: false, error: "notAllowed" };
  const { data, error } = await ctx.supabase
    .from("dashboard_shares")
    .delete()
    .eq("id", id as string)
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data.length) return { ok: false, error: "notAllowed" };
  return { ok: true, data: null };
}
