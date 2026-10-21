import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { FormTabs, type FormTab } from "@/components/forms/form-tabs";
import { requireFormAccess } from "@/lib/forms/access";
import { parseCapiSettings } from "@/lib/forms/capi";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

export default async function FormLayout({
  children,
  params,
}: LayoutProps<"/[locale]/forms/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  // 404 for forms the caller cannot see (existence is not revealed).
  const { form, canEdit } = await requireFormAccess(id, "view");
  const t = await getTranslations("formNav");
  const tabs: FormTab[] = canEdit
    ? ["builder", "settings", "dashboard", "responses"]
    : ["dashboard", "responses"];
  // Interview forms: quota, QC and backcheck (editors and admins).
  if (canEdit && parseCapiSettings(form.capi_settings).enabled) tabs.push("qc");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/forms"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToForms")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="min-w-0 truncate text-2xl font-semibold tracking-tight"
            data-testid="form-title"
          >
            {form.title}
          </h1>
          <FormStatusBadge status={form.status} />
        </div>
      </div>
      <div className="print:hidden">
        <FormTabs formId={form.id} tabs={tabs} />
      </div>
      {children}
    </div>
  );
}
