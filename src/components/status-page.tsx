import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { cn } from "@/lib/utils";

type StatusPageProps = {
  code: string;
  icon: ReactNode;
  title: string;
  description: string;
  fullScreen?: boolean;
};

/** Shared layout for 403 / 404 pages. */
export async function StatusPage({
  code,
  icon,
  title,
  description,
  fullScreen,
}: StatusPageProps) {
  const t = await getTranslations("common");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 px-4 py-16 text-center",
        fullScreen && "min-h-svh",
      )}
    >
      <div className="text-muted-foreground">{icon}</div>
      <p className="font-mono text-sm text-muted-foreground">{code}</p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-muted-foreground">{description}</p>
      <Button asChild variant="outline">
        <Link href="/">{t("backHome")}</Link>
      </Button>
    </div>
  );
}
