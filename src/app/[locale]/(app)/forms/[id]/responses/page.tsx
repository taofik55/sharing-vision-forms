import type { Metadata } from "next";
import { TableProperties } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { ResponsesView } from "@/components/responses/responses-view";
import {
  RESPONSE_SORTS,
  parseFilters,
  type ResponseSort,
} from "@/lib/analytics/filters";
import { loadFormVersions } from "@/lib/analytics/server";
import { requireFormAccess } from "@/lib/forms/access";
import { analysisQuestions } from "@/lib/forms/analysis";
import { parseCapiSettings } from "@/lib/forms/capi";
import type { Locale } from "@/lib/i18n/routing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("formResponses");
  return { title: t("title") };
}

// View access. Identifiers are masked in SQL for users without edit rights;
// deleting is offered to the owner and admins (enforced by RLS).
export default async function FormResponsesPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forms/[id]/responses">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { form, canManage } = await requireFormAccess(id, "view");
  const t = await getTranslations("formResponses");
  const { versions, questions, current } = await loadFormVersions(
    id,
    form.current_version_id,
  );
  if (!current) {
    return (
      <div data-testid="responses-placeholder">
        <EmptyState
          icon={<TableProperties className="size-6" aria-hidden />}
          title={t("title")}
          description={t("placeholder")}
        />
      </div>
    );
  }
  const sp = await searchParams;
  const sort =
    typeof sp.sort === "string" &&
    (RESPONSE_SORTS as readonly string[]).includes(sp.sort)
      ? sp.sort
      : "newest";
  const search = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";

  return (
    <ResponsesView
      formId={id}
      canDelete={canManage}
      questions={questions}
      columnKeys={analysisQuestions(current)
        .filter((q) => q.type !== "photo")
        .map((q) => q.key)}
      interview={parseCapiSettings(form.capi_settings).enabled}

      versions={versions}
      initialFilters={parseFilters(sp)}
      initialSearch={search}
      initialSort={sort as ResponseSort}
    />
  );
}
