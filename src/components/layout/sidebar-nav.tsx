"use client";

import {
  FileText,
  FlaskConical,
  House,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  isNavItemActive,
  type NavItem,
  type NavItemKey,
} from "@/lib/auth/roles";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItemKey, LucideIcon> = {
  home: House,
  forms: FileText,
  users: Users,
  demoTools: FlaskConical,
};

type SidebarNavProps = {
  items: NavItem[];
  onNavigate?: () => void;
};

export function SidebarNav({ items, onNavigate }: SidebarNavProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const main = items.filter((item) => item.section === "main");
  const admin = items.filter((item) => item.section === "admin");

  const renderItem = (item: NavItem) => {
    const Icon = ICONS[item.key];
    const active = isNavItemActive(item.href, pathname);
    return (
      <li key={item.key}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          data-testid={`nav-${item.key}`}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {t(item.key)}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label={t("label")} className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">{main.map(renderItem)}</ul>
      {admin.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-3 text-xs font-semibold tracking-wide text-sidebar-foreground/60 uppercase">
            {t("adminSection")}
          </p>
          <ul className="flex flex-col gap-1">{admin.map(renderItem)}</ul>
        </div>
      )}
    </nav>
  );
}
