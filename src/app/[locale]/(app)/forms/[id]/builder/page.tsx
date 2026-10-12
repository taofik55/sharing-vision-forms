import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Builder } from "@/components/builder/builder";
import { requireFormAccess } from "@/lib/forms/access";
import { hashDefinition } from "@/lib/forms/hash";
import { createQuestion, emptyDefinition } from "@/lib/forms/operations";
import { publicFormUrl, qrSvg } from "@/lib/forms/public-url";
import { formDefinitionSchema, type FormDefinition } from "@/lib/forms/schema";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("formNav");
  return { title: t("builder") };
}

export default async function BuilderPage({
  params,
}: PageProps<"/[locale]/forms/[id]/builder">) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);
  // Editors only: shared viewers get the 403 page.
  const { form } = await requireFormAccess(id, "edit");
  const t = await getTranslations("builder");
  const supabase = await createClient();

  const [{ data: version }, { count: responseCount }] = await Promise.all([
    form.current_version_id
      ? supabase
          .from("form_versions")
          .select("version_number, definition")
          .eq("id", form.current_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", id),
  ]);

  const parsed = formDefinitionSchema.safeParse(form.draft_definition);
  const definition: FormDefinition = parsed.success
    ? parsed.data
    : emptyDefinition(
        t("sectionTitle", { number: 1 }),
        createQuestion("short_text", {
          title: t("untitledQuestion"),
          option: (n) => t("option", { number: n }),
        }),
      );

  const url = publicFormUrl(form.slug, locale as Locale);

  return (
    <Builder
      formId={form.id}
      formTitle={form.title}
      formDescription={form.description}
      thankYouMessage={form.thank_you_message}
      initialDefinition={definition}
      initialUpdatedAt={form.updated_at}
      publishedHash={version ? hashDefinition(version.definition) : null}
      currentVersionNumber={version?.version_number ?? null}
      status={form.status}
      responseCount={responseCount ?? 0}
      publicUrl={url}
      qrSvg={await qrSvg(url)}
    />
  );
}
