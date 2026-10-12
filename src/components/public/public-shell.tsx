import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/** Minimal chrome for public, no-login pages (respondents, shared dashboards). */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex justify-end gap-1 p-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16">{children}</main>
    </div>
  );
}
