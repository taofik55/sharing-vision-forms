import { CircleSlash } from "lucide-react";
import { useTranslations } from "next-intl";

export function ClosedState({
  title,
  message,
}: {
  title?: string;
  message?: string | null;
}) {
  const t = useTranslations("publicForm");
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center"
      data-testid="form-closed"
    >
      <CircleSlash className="size-10 text-muted-foreground" aria-hidden />
      {title && <p className="text-sm text-muted-foreground">{title}</p>}
      <h1 className="text-xl font-semibold">{t("closedTitle")}</h1>
      <p className="whitespace-pre-line">{message || t("closedDefault")}</p>
    </div>
  );
}
