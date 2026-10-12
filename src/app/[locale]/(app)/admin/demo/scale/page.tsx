import type { Metadata } from "next";
import { FlaskConical } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { requireRole } from "@/lib/auth/session";
import { isDemoToolsEnabled } from "@/lib/env";
import type { Locale } from "@/lib/i18n/routing";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("demo");
  return { title: t("title") };
}

export default async function DemoScalePage({
  params,
}: PageProps<"/[locale]/admin/demo/scale">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  await requireRole(["admin"]);
  const t = await getTranslations();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("demo.title")}
        </h1>
        <p className="text-muted-foreground">{t("demo.subtitle")}</p>
      </div>
      {/* TODO(phase-5): demo data generator for scale testing (is_demo rows). */}
      <EmptyState
        icon={<FlaskConical className="size-6" aria-hidden />}
        title={t("common.comingSoon")}
        description={
          isDemoToolsEnabled() ? t("demo.subtitle") : t("demo.disabled")
        }
      />
    </div>
  );
}
