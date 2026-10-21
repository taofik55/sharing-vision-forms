import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { QcView, type QcOverview } from "@/components/qc/qc-view";
import { loadFormVersions } from "@/lib/analytics/server";
import type { DashboardBundle } from "@/lib/analytics/types";
import { requireFormAccess } from "@/lib/forms/access";
import { allCells, otherShares, parseCapiSettings } from "@/lib/forms/capi";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qc");
  return { title: t("title") };
}

export default async function QcPage({
  params,
}: PageProps<"/[locale]/forms/[id]/qc">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { form } = await requireFormAccess(id, "edit");
  const settings = parseCapiSettings(form.capi_settings);
  if (!settings.enabled) notFound();

  const supabase = await createClient();
  const [{ data: overview }, { data: bundle }, versions] = await Promise.all([
    supabase.rpc("qc_overview", { p_form_id: id }),
    supabase.rpc("dashboard_bundle", { p_form_id: id, p_filters: {} }),
    loadFormVersions(id, form.current_version_id),
  ]);

  const others = bundle
    ? otherShares(
        versions.questions,
        (bundle as unknown as DashboardBundle).questions as never,
        settings.qc.otherPercent,
      )
    : [];

  return (
    <QcView
      formId={id}
      settings={settings}
      cells={allCells(settings)}
      overview={(overview ?? null) as unknown as QcOverview | null}
      others={others}
    />
  );
}
