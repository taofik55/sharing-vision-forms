import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type FormStatus = "draft" | "published" | "closed" | "archived";

const STYLES: Record<FormStatus, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  published:
    "border-transparent bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  closed:
    "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
  archived: "border-dashed text-muted-foreground",
};

export function FormStatusBadge({
  status,
  className,
}: {
  status: FormStatus;
  className?: string;
}) {
  const t = useTranslations("formStatus");
  return (
    <Badge
      variant="outline"
      className={cn(STYLES[status], className)}
      data-testid="form-status"
      data-status={status}
    >
      {t(status)}
    </Badge>
  );
}
