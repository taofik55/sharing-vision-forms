import { TableProperties } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { requireFormAccess } from "@/lib/forms/access";
import type { Locale } from "@/lib/i18n/routing";

// Viewable by anyone with view access (shared viewers included). Read-only.
export default async function FormResponsesPage({
  params,
}: PageProps<"/[locale]/forms/[id]/responses">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  await requireFormAccess(id, "view");
  const t = await getTranslations("formResponses");

  return (
    <div data-testid="responses-placeholder">
      {/* TODO(phase-4): paginated responses table (server-side). */}
      <EmptyState
        icon={<TableProperties className="size-6" aria-hidden />}
        title={t("title")}
        description={t("placeholder")}
      />
    </div>
  );
}
