import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { parseFilters, toRpcFilters } from "@/lib/analytics/filters";
import { loadFormVersions, orderedQuestions } from "@/lib/analytics/server";
import type { DashboardBundle } from "@/lib/analytics/types";
import {
  exportColumns,
  exportFileName,
  summaryRows,
  type ExportRow,
} from "@/lib/export/format";
import {
  csvStream,
  exportBatches,
  xlsxStream,
  type FetchBatch,
} from "@/lib/export/stream";
import { locales, defaultLocale, type Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// 100k rows stream for a while; each keyset batch is its own short RPC call.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/forms/:id/export?format=csv|xlsx&ui=<id|en>&<dashboard filters>
 * Signed-in users with view access. Identifier columns (and unmasked email /
 * phone answers) only for users with edit rights (enforced in export_responses).
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/forms/[id]/export">,
) {
  const { id } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const format = params.get("format");
  if (format !== "csv" && format !== "xlsx") {
    return Response.json({ error: "invalid_format" }, { status: 400 });
  }
  if (!UUID.test(id))
    return Response.json({ error: "not_found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // RLS: only forms the caller can view (no hint whether others exist).
  const { data: form } = await supabase
    .from("forms")
    .select("id, title, current_version_id")
    .eq("id", id)
    .maybeSingle();
  if (!form) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: canEdit } = await supabase.rpc("can_edit_form", {
    p_form_id: id,
  });

  const ui = params.get("ui");
  const locale: Locale = locales.includes(ui as Locale)
    ? (ui as Locale)
    : defaultLocale;
  const t = await getTranslations({ locale, namespace: "export" });
  const tTypes = await getTranslations({ locale, namespace: "questionTypes" });

  const { questions, current } = await loadFormVersions(
    id,
    form.current_version_id,
  );
  const ordered = orderedQuestions(questions, current);
  const rpcFilters = toRpcFilters(parseFilters(params));

  const columns = exportColumns(
    ordered,
    {
      responseId: t("columns.responseId"),
      submittedAtUtc: t("columns.submittedAtUtc"),
      submittedAtLocal: t("columns.submittedAtLocal"),
      version: t("columns.version"),
      identifierEmail: t("columns.identifierEmail"),
      identifierPhone: t("columns.identifierPhone"),
      other: t("other"),
    },
    canEdit === true,
  );

  const fetchBatch: FetchBatch = async (cursor, limit) => {
    const { data, error } = await supabase.rpc("export_responses", {
      p_form_id: id,
      p_filters: rpcFilters as never,
      p_after_at: cursor?.at,
      p_after_id: cursor?.id,
      p_limit: limit,
    });
    if (error) throw new Error(`export_responses failed: ${error.code}`);
    return (data ?? []) as unknown as ExportRow[];
  };
  const batches = exportBatches(fetchBatch);

  const stream =
    format === "csv"
      ? csvStream(columns, batches)
      : xlsxStream({
          columns,
          batches,
          sheetNames: {
            responses: t("sheets.responses"),
            summary: t("sheets.summary"),
          },
          summary: async () => {
            const { data, error } = await supabase.rpc("dashboard_bundle", {
              p_form_id: id,
              p_filters: rpcFilters as never,
            });
            if (error || !data) throw new Error("dashboard_bundle failed");
            const bundle = data as unknown as DashboardBundle;
            return summaryRows(
              ordered,
              bundle.questions,
              bundle.overview.total,
              {
                question: t("summary.question"),
                type: t("summary.type"),
                answered: t("summary.answered"),
                value: t("summary.value"),
                count: t("summary.count"),
                percent: t("summary.percent"),
                total: t("summary.total"),
                mean: t("summary.mean"),
                median: t("summary.median"),
                min: t("summary.min"),
                max: t("summary.max"),
                averageLength: t("summary.averageLength"),
                other: t("other"),
                typeLabel: (type) => tTypes(type),
              },
            );
          },
        });

  const fileName = exportFileName(form.title, format);
  return new Response(stream, {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
