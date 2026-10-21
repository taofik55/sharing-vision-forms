import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  DangerZone,
  PublishControls,
} from "@/components/forms/form-status-controls";
import { CapiSettingsCard } from "@/components/forms/capi-settings-card";
import { PublicLink } from "@/components/forms/public-link";
import { SettingsForm } from "@/components/forms/settings-form";
import { SharingCard, type Member } from "@/components/forms/sharing-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireFormAccess } from "@/lib/forms/access";
import { parseCapiSettings } from "@/lib/forms/capi";
import { flattenQuestions, formDefinitionSchema } from "@/lib/forms/schema";
import { publicFormUrl, qrSvg } from "@/lib/forms/public-url";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { utcIsoToJakartaLocal } from "@/lib/time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("formSettings");
  return { title: t("title") };
}

export default async function FormSettingsPage({
  params,
}: PageProps<"/[locale]/forms/[id]/settings">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  const { form, canManage } = await requireFormAccess(id, "edit");
  const t = await getTranslations("formSettings");
  const supabase = await createClient();

  const [
    { data: members },
    { data: owners },
    { data: version },
    { count: responseCount },
  ] = await Promise.all([
    supabase.rpc("list_form_members", { p_form_id: id }),
    supabase.rpc("list_form_owners"),
    form.current_version_id
      ? supabase
          .from("form_versions")
          .select("version_number")
          .eq("id", form.current_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", id),
  ]);

  const draft = formDefinitionSchema.safeParse(form.draft_definition);
  const choiceQuestions = draft.success
    ? flattenQuestions(draft.data)
        .filter((q) => q.type === "multiple_choice" || q.type === "dropdown")
        .map((q) => ({
          key: q.key,
          title: q.title,
          code: q.code,
          options: q.options,
        }))
    : [];
  const capi = parseCapiSettings(form.capi_settings);

  const ownerName = owners?.find((o) => o.id === form.owner_id)?.name ?? "—";
  const isLive = form.status === "published" || form.status === "closed";
  const url = publicFormUrl(form.slug, locale as Locale);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("details")}</CardTitle>
            <CardDescription>{t("detailsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm
              formId={form.id}
              defaultValues={{
                title: form.title,
                description: form.description ?? "",
                slug: form.slug,
                identifierMode: form.identifier_mode,
                deadlineLocal: utcIsoToJakartaLocal(form.deadline_at),
                closedMessage: form.closed_message ?? "",
                thankYouMessage: form.thank_you_message ?? "",
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("capi")}</CardTitle>
            <CardDescription>{t("capiDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CapiSettingsCard
              formId={form.id}
              initial={capi}
              questions={choiceQuestions}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("sharing")}</CardTitle>
            <CardDescription>{t("sharingDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <SharingCard
              formId={form.id}
              ownerName={ownerName}
              canManage={canManage}
              members={(members ?? []).map((m): Member => ({
                userId: m.user_id,
                email: m.email,
                fullName: m.full_name,
                role: m.role,
                appRole: m.app_role,
              }))}
            />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("publishing")}</CardTitle>
            <CardDescription>
              {version
                ? t("currentVersion", { number: version.version_number })
                : t("neverPublished")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {isLive && !capi.enabled && (
              <PublicLink
                url={url}
                qrSvg={await qrSvg(url)}
                closed={form.status === "closed"}
              />
            )}
            <PublishControls formId={form.id} status={form.status} />
          </CardContent>
        </Card>
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>{t("dangerZone")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DangerZone
              formId={form.id}
              title={form.title}
              status={form.status}
              responseCount={responseCount ?? 0}
              canManage={canManage}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
