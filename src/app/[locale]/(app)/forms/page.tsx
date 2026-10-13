import type { Metadata } from "next";
import { FileText, SearchX } from "lucide-react";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { FormsList, type FormListRow } from "@/components/forms/forms-list";
import { FormsToolbar } from "@/components/forms/forms-toolbar";
import { NewFormDialog } from "@/components/forms/new-form-dialog";
import { Button } from "@/components/ui/button";
import { canCreateForms } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { FORMS_PAGE_SIZE, parseFormsQuery } from "@/lib/forms/list-query";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forms");
  return { title: t("title") };
}

export default async function FormsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forms">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requireUser();
  const query = parseFormsQuery(await searchParams);
  const t = await getTranslations("forms");
  const format = await getFormatter();
  const canCreate = canCreateForms(user.role);

  // Aggregation (response counts, last response) happens in Postgres.
  const supabase = await createClient();
  const [{ data, error }, { data: owners }] = await Promise.all([
    supabase.rpc("list_forms", {
      p_search: query.q || undefined,
      p_status: query.status ?? undefined,
      p_owner: query.owner ?? undefined,
      p_scope: query.scope,
      p_sort: query.sort,
      p_limit: FORMS_PAGE_SIZE,
      p_offset: (query.page - 1) * FORMS_PAGE_SIZE,
      p_include_demo: query.demo,
    }),
    supabase.rpc("list_form_owners"),
  ]);
  if (error) throw new Error("Failed to load forms");

  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const rows: FormListRow[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    ownerName: r.owner_name,
    access: r.access as FormListRow["access"],
    responseCount: Number(r.response_count),
    lastResponseLabel: r.last_response_at ? dateTime(r.last_response_at) : null,
    updatedLabel: dateTime(r.updated_at),
    versionNumber: r.current_version_number,
    hasUnpublishedChanges: r.has_unpublished_changes,
    canEdit: r.can_edit,
    canManage: r.access === "owner" || user.role === "admin",
    isDemo: r.is_demo,
  }));
  const total = Number(data?.[0]?.total_count ?? 0);
  const filtered = Boolean(
    query.q || query.status || query.owner || query.scope !== "all",
  );
  const from = (query.page - 1) * FORMS_PAGE_SIZE + 1;
  const to = from + rows.length - 1;

  const pageHref = (page: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({
      q: query.q,
      status: query.status,
      owner: query.owner,
    }))
      if (v) sp.set(k, v);
    if (query.scope !== "all") sp.set("scope", query.scope);
    if (query.sort !== "updated_desc") sp.set("sort", query.sort);
    if (query.view !== "table") sp.set("view", query.view);
    if (page > 1) sp.set("page", String(page));
    if (query.demo) sp.set("demo", "1");
    const qs = sp.toString();
    return qs ? `/forms?${qs}` : "/forms";
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canCreate && <NewFormDialog />}
      </div>

      <FormsToolbar query={query} owners={owners ?? []} />

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden />}
            title={t("noResults")}
            description=""
            action={
              <Button asChild variant="outline">
                <Link href="/forms">{t("clearFilters")}</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FileText className="size-6" aria-hidden />}
            title={t("emptyTitle")}
            description={canCreate ? t("emptyEditor") : t("emptyViewer")}
          />
        )
      ) : (
        <>
          <FormsList rows={rows} view={query.view} canCreate={canCreate} />
          <nav
            aria-label={t("pagination.label")}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="text-muted-foreground">
              {t("pagination.summary", { from, to, total })}
            </span>
            <div className="flex gap-2">
              {query.page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(query.page - 1)}>
                    {t("pagination.previous")}
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  {t("pagination.previous")}
                </Button>
              )}
              {to < total ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(query.page + 1)}>
                    {t("pagination.next")}
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  {t("pagination.next")}
                </Button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
