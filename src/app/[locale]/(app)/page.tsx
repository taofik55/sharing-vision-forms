import { FileText } from "lucide-react";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { NewFormDialog } from "@/components/forms/new-form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canCreateForms } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requireUser();
  const t = await getTranslations();
  const format = await getFormatter();
  const canCreate = canCreateForms(user.role);

  const supabase = await createClient();
  const { data: recent } = await supabase.rpc("list_forms", {
    p_sort: "updated_desc",
    p_limit: 5,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("home.title", { name: user.fullName ?? user.email })}
          </h1>
          <p className="text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        {canCreate && <NewFormDialog />}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("home.recentForms")}</CardTitle>
          {recent && recent.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/forms">{t("formNav.backToForms")}</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {recent && recent.length > 0 ? (
            <ul className="divide-y">
              {recent.map((form) => (
                <li
                  key={form.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <Link
                    href={
                      form.can_edit
                        ? `/forms/${form.id}/builder`
                        : `/forms/${form.id}/dashboard`
                    }
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {form.title}
                  </Link>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    {t("forms.responsesCount", {
                      count: Number(form.response_count),
                    })}
                    <span className="hidden sm:inline">
                      {format.dateTime(new Date(form.updated_at), {
                        dateStyle: "medium",
                      })}
                    </span>
                    <FormStatusBadge status={form.status} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<FileText className="size-6" aria-hidden />}
              title={t("home.emptyTitle")}
              description={
                canCreate ? t("home.emptyEditor") : t("home.emptyViewer")
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
