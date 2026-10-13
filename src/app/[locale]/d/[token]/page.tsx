import type { Metadata } from "next";
import { LinkIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicDashboard } from "@/components/public/public-dashboard";
import { PublicShell } from "@/components/public/public-shell";
import { parseConfig } from "@/lib/analytics/config";
import {
  EMPTY_FILTERS,
  parseFilters,
  toRpcFilters,
  type DashboardFilters,
} from "@/lib/analytics/filters";
import { mergeDashboardConfig } from "@/lib/analytics/merge";
import { loadFormVersions } from "@/lib/analytics/server";
import type { DashboardBundle } from "@/lib/analytics/types";
import type { Locale } from "@/lib/i18n/routing";
import { resolveShare, runPublicCall } from "@/lib/shares/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicDashboard");
  return { title: t("title"), robots: { index: false, follow: false } };
}

// Public, no auth. Read-only shared dashboard resolved by token. The secret
// key is used only after the token resolved to an active share, and only for
// that share's form (see src/lib/shares/server.ts).
export default async function PublicDashboardPage({
  params,
  searchParams,
}: PageProps<"/[locale]/d/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("publicDashboard");

  const share = await resolveShare(token);
  if (!share) {
    return (
      <PublicShell>
        <div
          className="flex max-w-md flex-col items-center gap-3 py-16 text-center"
          data-testid="share-unavailable"
        >
          <LinkIcon className="size-8 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("unavailableTitle")}
          </h1>
          <p className="text-muted-foreground">{t("unavailableDescription")}</p>
        </div>
      </PublicShell>
    );
  }

  // Date range only.
  const parsed = parseFilters(await searchParams);
  const filters: DashboardFilters = {
    ...EMPTY_FILTERS,
    versionIds: [],
    answers: [],
    range: parsed.range,
    from: parsed.from,
    to: parsed.to,
    compare: parsed.compare,
  };
  const rpcFilters = toRpcFilters(filters);

  const admin = createAdminClient();
  const [{ versions, questions, current }, { data: saved }, { status, body }] =
    await Promise.all([
      loadFormVersions(share.formId, share.currentVersionId, admin),
      admin
        .from("dashboards")
        .select("config")
        .eq("form_id", share.formId)
        .maybeSingle(),
      runPublicCall(share, { fn: "bundle" }, rpcFilters),
    ]);
  if (!current || status !== 200)
    throw new Error("Failed to load shared dashboard");
  const { data: form } = await admin
    .from("forms")
    .select("is_demo")
    .eq("id", share.formId)
    .single();

  return (
    <PublicShell>
      <div className="w-full max-w-7xl" data-testid="public-dashboard">
        <p className="mb-4 text-xs text-muted-foreground print:hidden">
          {t("readOnlyNotice")}
        </p>
        <PublicDashboard
          token={token}
          formId={share.formId}
          definition={current}
          questions={questions}
          versions={versions}
          initialConfig={mergeDashboardConfig(
            parseConfig(saved?.config),
            current,
          )}
          initialFilters={filters}
          initialRpcFilters={rpcFilters}
          initialBundle={body as DashboardBundle}
          isDemo={form?.is_demo ?? false}
          textAnswers={share.includeTextAnswers}
        />
      </div>
    </PublicShell>
  );
}
