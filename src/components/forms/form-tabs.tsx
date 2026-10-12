"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

export type FormTab = "builder" | "settings" | "dashboard" | "responses";

export function FormTabs({
  formId,
  tabs,
}: {
  formId: string;
  tabs: FormTab[];
}) {
  const t = useTranslations("formNav");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("label")}
      className="-mb-px flex gap-1 overflow-x-auto border-b"
    >
      {tabs.map((tab) => {
        const href = `/forms/${formId}/${tab}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${tab}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab)}
          </Link>
        );
      })}
    </nav>
  );
}
