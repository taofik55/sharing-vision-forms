import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/** Minimal chrome for public, no-login pages (respondents, shared dashboards). */
export async function PublicShell({ children }: { children: ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center gap-1 p-4 print:hidden">
        <Brand
          appName={t("appName")}
          productName={t("productName")}
          size="sm"
        />
        <div className="ml-auto flex gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16">{children}</main>
    </div>
  );
}
