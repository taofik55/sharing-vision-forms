import { setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { Locale } from "@/lib/i18n/routing";

export default async function AuthLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex justify-end gap-1 p-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        {children}
      </main>
    </div>
  );
}
