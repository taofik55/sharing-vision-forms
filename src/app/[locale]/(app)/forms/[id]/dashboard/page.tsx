import type { Metadata } from "next";
import { ChartColumn } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { EmptyState } from "@/components/empty-state";
import { parseConfig } from "@/lib/analytics/config";
import { parseFilters, toRpcFilters } from "@/lib/analytics/filters";
import { mergeDashboardConfig } from "@/lib/analytics/merge";
import { loadFormVersions } from "@/lib/analytics/server";
import type { DashboardBundle } from "@/lib/analytics/types";
import { requireFormAccess } from "@/lib/forms/access";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("formDashboard");
  return { title: t("title") };
}

// Viewable by anyone with view access (shared viewers included).
// Editing controls are only rendered for users with edit access.
export default async function FormDashboardPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forms/[id]/dashboard">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { form, canEdit } = await requireFormAccess(id, "view");
  const t = await getTranslations("dashboard");
  const tf = await getTranslations("formDashboard");

  const { versions, questions, current } = await loadFormVersions(
    id,
    form.current_version_id,
  );
  if (!current) {
    return (
      <div data-testid="dashboard-placeholder">
        <EmptyState
          icon={<ChartColumn className="size-6" aria-hidden />}
          title={tf("title")}
          description={t("notPublished")}
        />
      </div>
    );
  }

  const supabase = await createClient();
  const filters = parseFilters(await searchParams);
  const rpcFilters = toRpcFilters(filters);
  const [{ data: saved }, { data: bundle, error }] = await Promise.all([
    supabase
      .from("dashboards")
      .select("config")
      .eq("form_id", id)
      .maybeSingle(),
    supabase.rpc("dashboard_bundle", {
      p_form_id: id,
      p_filters: rpcFilters as never,
    }),
  ]);
  if (error || !bundle) throw new Error("Failed to load dashboard");

  // New versions add widgets for new questions; user customizations stay.
  const config = mergeDashboardConfig(parseConfig(saved?.config), current);

  return (
    <DashboardView
      formId={id}
      canEdit={canEdit}
      definition={current}
      questions={questions}
      versions={versions}
      initialConfig={config}
      initialFilters={filters}
      initialRpcFilters={rpcFilters}
      initialBundle={bundle as unknown as DashboardBundle}
      isDemo={form.is_demo}
    />
  );
}
