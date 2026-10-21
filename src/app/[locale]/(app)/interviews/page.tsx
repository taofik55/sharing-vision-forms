import { ClipboardList } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { FormStatusBadge } from "@/components/forms/form-status-badge";
import { OutboxPanel } from "@/components/interviews/offline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export default async function InterviewsPage({
  params,
}: PageProps<"/[locale]/interviews">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requireUser();
  const t = await getTranslations("interviews");
  const supabase = await createClient();
  const { data: forms } = await supabase.rpc("list_interview_forms");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <OutboxPanel />
      {forms && forms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {forms.map((form) => (
            <Card key={form.id} data-testid="interview-form">
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="leading-snug">{form.title}</CardTitle>
                  <FormStatusBadge status={form.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/50 p-2">
                    <dt className="text-xs text-muted-foreground">
                      {t("myToday")}
                    </dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {form.my_today}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <dt className="text-xs text-muted-foreground">
                      {t("myTotal")}
                    </dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {form.my_total}
                    </dd>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2">
                    <dt className="text-xs text-muted-foreground">
                      {t("myScreenouts")}
                    </dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {form.my_screenouts}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {t("teamTotal", { count: form.total })}
                </p>
                {form.status === "published" ? (
                  <Button asChild>
                    <Link
                      href={`/interviews/${form.id}`}
                      data-testid="start-interviews"
                    >
                      {t("open")}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("closed")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ClipboardList className="size-6" aria-hidden />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      )}
    </div>
  );
}
