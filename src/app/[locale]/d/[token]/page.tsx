import { getTranslations, setRequestLocale } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Locale } from "@/lib/i18n/routing";

// Public, no auth. Read-only shared dashboard resolved by token.
// TODO(phase-4): validate the share token server-side and render the dashboard.
export default async function PublicDashboardPage({
  params,
}: PageProps<"/[locale]/d/[token]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("publicDashboard");

  return (
    <PublicShell>
      <Card className="h-fit w-full max-w-4xl">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("placeholder")}</CardDescription>
        </CardHeader>
      </Card>
    </PublicShell>
  );
}
