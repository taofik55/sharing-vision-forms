import { getTranslations, setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MobileNav } from "@/components/layout/mobile-nav";
import { RoleBadge } from "@/components/layout/role-badge";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getNavItems } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { Link } from "@/lib/i18n/navigation";
import type { Locale } from "@/lib/i18n/routing";

export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const user = await requireUser();
  const t = await getTranslations("common");
  const navItems = getNavItems(user.role);

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground md:flex">
        <Link
          href="/"
          className="px-3 py-1 text-lg font-semibold tracking-tight"
        >
          {t("appName")}
        </Link>
        <SidebarNav items={navItems} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
          <MobileNav items={navItems} />
          <span className="font-semibold md:hidden">{t("appName")}</span>
          <div className="ml-auto flex items-center gap-1">
            <RoleBadge role={user.role} />
            <LanguageSwitcher />
            <ThemeToggle />
            <UserMenu fullName={user.fullName} email={user.email} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
