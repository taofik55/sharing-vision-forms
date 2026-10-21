import type { Database } from "@/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];

export const APP_ROLES = [
  "admin",
  "editor",
  "viewer",
  "surveyor",
] as const satisfies readonly AppRole[];

export function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === "string" &&
    (APP_ROLES as readonly string[]).includes(value)
  );
}

export function canCreateForms(role: AppRole): boolean {
  return role === "admin" || role === "editor";
}

export function isAdmin(role: AppRole): boolean {
  return role === "admin";
}

export type NavItemKey =
  "home" | "forms" | "interviews" | "users" | "demoTools";

/** Field staff: interviews only (no forms, dashboards or responses). */
export function isSurveyor(role: AppRole): boolean {
  return role === "surveyor";
}

export type NavItem = {
  key: NavItemKey;
  href: string;
  section: "main" | "admin";
};

/** Role-aware sidebar navigation. Hrefs are locale-less (next-intl adds the prefix). */
export function getNavItems(role: AppRole): NavItem[] {
  if (isSurveyor(role))
    return [{ key: "interviews", href: "/interviews", section: "main" }];
  const items: NavItem[] = [
    { key: "home", href: "/", section: "main" },
    { key: "forms", href: "/forms", section: "main" },
    { key: "interviews", href: "/interviews", section: "main" },
  ];
  if (isAdmin(role)) {
    items.push(
      { key: "users", href: "/admin/users", section: "admin" },
      { key: "demoTools", href: "/admin/demo/scale", section: "admin" },
    );
  }
  return items;
}

/** Home matches exactly; sections match their own path and any sub-path. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
