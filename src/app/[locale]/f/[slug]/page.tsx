import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ClosedState } from "@/components/public/closed-state";
import { PublicForm } from "@/components/public/public-form";
import { PublicShell } from "@/components/public/public-shell";
import { loadPublicForm } from "@/lib/forms/public";
import type { Locale } from "@/lib/i18n/routing";

// Public, no auth. Status and deadline must be fresh on every request.
export const dynamic = "force-dynamic";

const NOINDEX: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/f/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const state = await loadPublicForm(slug);
  if (state.state === "not_found") {
    const t = await getTranslations("publicForm");
    return { title: t("notFoundTitle"), robots: NOINDEX };
  }
  return {
    title: state.state === "open" ? state.form.title : state.title,
    robots: NOINDEX,
  };
}

export default async function PublicFormPage({
  params,
}: PageProps<"/[locale]/f/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);
  // Loaded with the admin client, but only the current published version is
  // returned: never the draft, owner or other tables.
  const state = await loadPublicForm(slug);
  if (state.state === "not_found") notFound();

  return (
    <PublicShell>
      {state.state === "closed" ? (
        <ClosedState title={state.title} message={state.closedMessage} />
      ) : (
        <PublicForm form={state.form} />
      )}
    </PublicShell>
  );
}
