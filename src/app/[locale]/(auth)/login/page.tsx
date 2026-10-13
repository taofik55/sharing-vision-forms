import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Brand } from "@/components/brand";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isLoginErrorKey } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/paths";
import type { Locale } from "@/lib/i18n/routing";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("submit") };
}

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const query = await searchParams;
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");

  const next = safeNextPath(
    typeof query.next === "string" ? query.next : undefined,
  );
  const initialError = isLoginErrorKey(query.error) ? query.error : null;
  const signedOut = query.signedOut === "1";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <Brand
          appName={tc("appName")}
          productName={tc("productName")}
          size="lg"
          className="mb-3"
        />
        <CardTitle className="text-xl">{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm
          next={next}
          initialError={initialError}
          signedOut={signedOut}
        />
      </CardContent>
    </Card>
  );
}
