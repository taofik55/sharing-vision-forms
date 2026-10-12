import { ChartColumn } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { requireFormAccess } from "@/lib/forms/access";
import type { Locale } from "@/lib/i18n/routing";

// Viewable by anyone with view access (shared viewers included). Read-only.
export default async function FormDashboardPage({
  params,
}: PageProps<"/[locale]/forms/[id]/dashboard">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  await requireFormAccess(id, "view");
  const t = await getTranslations("formDashboard");

  return (
    <div data-testid="dashboard-placeholder">
      {/* TODO(phase-4): live auto-generated dashboard (aggregated in SQL). */}
      <EmptyState
        icon={<ChartColumn className="size-6" aria-hidden />}
        title={t("title")}
        description={t("placeholder")}
      />
    </div>
  );
}
