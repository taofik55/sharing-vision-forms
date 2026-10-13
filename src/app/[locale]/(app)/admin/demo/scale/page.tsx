import type { Metadata } from "next";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SetupScaleForm } from "@/components/demo/setup-scale-form";
import { ScaleLab } from "@/components/demo/scale-lab";
import { EmptyState } from "@/components/empty-state";
import { parseConfig } from "@/lib/analytics/config";
import { EMPTY_FILTERS } from "@/lib/analytics/filters";
import { mergeDashboardConfig } from "@/lib/analytics/merge";
import { loadFormVersions } from "@/lib/analytics/server";
import type { DashboardBundle } from "@/lib/analytics/types";
import { requireRole } from "@/lib/auth/session";
import { DEMO_FORMS } from "@/lib/demo/server";
import { isDemoToolsEnabled } from "@/lib/env";
import type { Locale } from "@/lib/i18n/routing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("demo");
  return { title: t("title") };
}

// Admin only (layout) AND only with ENABLE_DEMO_TOOLS=true. Everything this
// page creates is flagged is_demo = true.
export default async function DemoScalePage({
  params,
}: PageProps<"/[locale]/admin/demo/scale">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requireRole(["admin"]);
  const t = await getTranslations("demo");

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("subtitle")}</p>
    </div>
  );

  if (!isDemoToolsEnabled()) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<FlaskConical className="size-6" aria-hidden />}
          title={t("disabledTitle")}
          description={t("disabled")}
        />
      </div>
    );
  }

  const banner = (
    <div
      className="flex items-start gap-3 rounded-lg border-2 border-amber-500 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200"
      role="note"
      data-testid="demo-banner"
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold tracking-wide uppercase">
          {t("banner.title")}
        </p>
        <p className="text-sm">{t("banner.description")}</p>
      </div>
    </div>
  );

  const { data: form } = await createAdminClient()
    .from("forms")
    .select("id, current_version_id, is_demo")
    .eq("slug", DEMO_FORMS.scale.slug)
    .maybeSingle();

  if (!form?.is_demo || !form.current_version_id) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {banner}
        <EmptyState
          icon={<FlaskConical className="size-6" aria-hidden />}
          title={t("setup.title")}
          description={t("setup.description")}
          action={<SetupScaleForm />}
        />
      </div>
    );
  }

  const supabase = await createClient();
  const [
    { versions, questions, current },
    { data: saved },
    { data: bundle, error },
  ] = await Promise.all([
    loadFormVersions(form.id, form.current_version_id),
    supabase
      .from("dashboards")
      .select("config")
      .eq("form_id", form.id)
      .maybeSingle(),
    supabase.rpc("dashboard_bundle", { p_form_id: form.id, p_filters: {} }),
  ]);
  if (!current || error || !bundle)
    throw new Error("Failed to load the demo dashboard");

  return (
    <div className="flex flex-col gap-6">
      {header}
      {banner}
      <ScaleLab
        formId={form.id}
        definition={current}
        questions={questions}
        versions={versions}
        initialConfig={mergeDashboardConfig(
          parseConfig(saved?.config),
          current,
        )}
        initialFilters={{ ...EMPTY_FILTERS, versionIds: [], answers: [] }}
        initialRpcFilters={{}}
        initialBundle={bundle as unknown as DashboardBundle}
        isDemo
      />
    </div>
  );
}
