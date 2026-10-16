import "server-only";
import { randomBytes } from "node:crypto";
import { fieldType, type ChartSpec } from "@/lib/analytics/chart-spec";
import { parseConfig } from "@/lib/analytics/config";
import { loadFormVersions } from "@/lib/analytics/server";
import type { DashboardBundle, QuestionStats } from "@/lib/analytics/types";
import type { Locale } from "@/lib/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export type ShareRow = Database["public"]["Tables"]["dashboard_shares"]["Row"];

/** Tokens are 43 url-safe characters (32 random bytes). */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function publicDashboardUrl(token: string, locale: Locale): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  return `${base}/${locale}/d/${token}`;
}

export type ResolvedShare = {
  formId: string;
  currentVersionId: string;
  includeTextAnswers: boolean;
};

/**
 * Active, unexpired share of a published form, or null. Uses the secret key:
 * every later query is scoped to the returned form id.
 */
export async function resolveShare(
  token: string,
): Promise<ResolvedShare | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("dashboard_shares")
    .select("form_id, is_active, expires_at, include_text_answers")
    .eq("token", token)
    .maybeSingle();
  if (!share || !share.is_active) return null;
  if (share.expires_at && Date.parse(share.expires_at) <= Date.now())
    return null;
  const { data: form } = await admin
    .from("forms")
    .select("id, current_version_id, status")
    .eq("id", share.form_id)
    .maybeSingle();
  if (!form?.current_version_id || form.status === "archived") return null;
  return {
    formId: form.id,
    currentVersionId: form.current_version_id,
    includeTextAnswers: share.include_text_answers,
  };
}

/**
 * What a public dashboard may see: no creator name / email, and no free-text
 * content (top terms) unless the share allows text answers. Identifiers are
 * never part of the bundle.
 */
export function sanitizePublicBundle(
  bundle: DashboardBundle,
  includeText: boolean,
): DashboardBundle {
  const questions: Record<string, QuestionStats> = {};
  for (const [key, stats] of Object.entries(bundle.questions)) {
    questions[key] =
      !includeText &&
      (stats.type === "short_text" || stats.type === "paragraph")
        ? { ...stats, terms: [], avg_length: null }
        : stats;
  }
  return {
    ...bundle,
    form: { ...bundle.form, creator: "" },
    questions,
  };
}

const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Date range only (public dashboards have no other filters). */
export function publicFilters(params: URLSearchParams): {
  from?: string;
  to?: string;
} {
  const filters: { from?: string; to?: string } = {};
  const from = params.get("from");
  const to = params.get("to");
  if (from && ISO.test(from) && !Number.isNaN(Date.parse(from)))
    filters.from = from;
  if (to && ISO.test(to) && !Number.isNaN(Date.parse(to))) filters.to = to;
  return filters;
}

export type PublicCall =
  | { fn: "bundle" }
  | { fn: "suggestions" }
  | { fn: "cross"; a: string; b: string }
  | { fn: "text"; key: string; beforeAt?: string; beforeId?: string }
  | { fn: "chart"; widgetId: string };

export function parsePublicCall(params: URLSearchParams): PublicCall | null {
  switch (params.get("fn")) {
    case "bundle":
      return { fn: "bundle" };
    case "suggestions":
      return { fn: "suggestions" };
    case "cross": {
      const a = params.get("a") ?? "";
      const b = params.get("b") ?? "";
      return KEY.test(a) && KEY.test(b) ? { fn: "cross", a, b } : null;
    }
    case "chart": {
      const widgetId = params.get("widget") ?? "";
      return /^[A-Za-z0-9_:-]{1,100}$/.test(widgetId)
        ? { fn: "chart", widgetId }
        : null;
    }
    case "text": {
      const key = params.get("key") ?? "";
      const beforeAt = params.get("before_at") ?? undefined;
      const beforeId = params.get("before_id") ?? undefined;
      if (!KEY.test(key)) return null;
      if (
        (beforeAt && !ISO.test(beforeAt)) ||
        (beforeId && !UUID.test(beforeId))
      )
        return null;
      return { fn: "text", key, beforeAt, beforeId };
    }
    default:
      return null;
  }
}

/** Runs a whitelisted dashboard RPC for the share's form only. */
export async function runPublicCall(
  share: ResolvedShare,
  call: PublicCall,
  filters: { from?: string; to?: string },
): Promise<{ status: number; body: unknown }> {
  const admin = createAdminClient();
  switch (call.fn) {
    case "bundle": {
      const { data, error } = await admin.rpc("dashboard_bundle", {
        p_form_id: share.formId,
        p_filters: filters,
      });
      if (error || !data)
        return { status: 500, body: { error: "server_error" } };
      return {
        status: 200,
        body: sanitizePublicBundle(
          data as unknown as DashboardBundle,
          share.includeTextAnswers,
        ),
      };
    }
    case "suggestions": {
      const { data, error } = await admin.rpc("cross_suggestions", {
        p_form_id: share.formId,
        p_filters: filters,
      });
      if (error) return { status: 500, body: { error: "server_error" } };
      return { status: 200, body: data };
    }
    case "cross": {
      const { data, error } = await admin.rpc("cross_stats", {
        p_form_id: share.formId,
        p_question_a: call.a,
        p_question_b: call.b,
        p_filters: filters,
      });
      if (error)
        return {
          status: error.code === "P0002" ? 404 : 500,
          body: { error: "not_found" },
        };
      return { status: 200, body: data };
    }
    case "chart": {
      // Only charts saved in the dashboard config run here; the request never
      // carries a spec. Text columns follow the share's free-text setting.
      const { data: saved } = await admin
        .from("dashboards")
        .select("config")
        .eq("form_id", share.formId)
        .maybeSingle();
      const widget = parseConfig(saved?.config)?.widgets.find(
        (w) => w.id === call.widgetId && w.kind === "custom" && !w.hidden,
      );
      const spec: ChartSpec | undefined = widget?.custom;
      if (!spec) return { status: 404, body: { error: "not_found" } };
      if (!share.includeTextAnswers) {
        const { questions } = await loadFormVersions(
          share.formId,
          share.currentVersionId,
          admin,
        );
        const refs = [
          ...spec.dimensions.map((d) => d.field),
          ...spec.filters.map((x) => x.field),
        ];
        if (refs.some((r) => fieldType(r, questions) === "text"))
          return { status: 403, body: { error: "text_answers_hidden" } };
      }
      const { data, error } = await admin.rpc("dashboard_query", {
        p_form_id: share.formId,
        p_spec: spec as never,
        p_filters: filters,
      });
      if (error) return { status: 500, body: { error: "server_error" } };
      return { status: 200, body: data };
    }
    case "text": {
      if (!share.includeTextAnswers)
        return { status: 403, body: { error: "text_answers_hidden" } };
      const { data, error } = await admin.rpc("question_text_answers", {
        p_form_id: share.formId,
        p_question_key: call.key,
        p_filters: filters,
        p_before_at: call.beforeAt,
        p_before_id: call.beforeId,
        p_limit: 25,
      });
      if (error) return { status: 500, body: { error: "server_error" } };
      // Rows: response id (keyset cursor), submitted_at, text. Never identifiers.
      return { status: 200, body: data };
    }
  }
}
