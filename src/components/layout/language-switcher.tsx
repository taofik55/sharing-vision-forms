"use client";

import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === locale) return;
    // Read the query at click time to avoid useSearchParams (needs Suspense).
    const search = window.location.search;
    startTransition(() => {
      router.replace(`${pathname}${search}`, { locale: next });
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("label")}
          disabled={isPending}
          data-testid="language-switcher"
        >
          <Languages aria-hidden />
          <span className="font-mono text-xs uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {routing.locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => switchTo(code)}
            lang={code}
          >
            <Check
              className={code === locale ? "opacity-100" : "opacity-0"}
              aria-hidden
            />
            {t(code)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
