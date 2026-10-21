import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";

/** /f/<slug> of an interview-only (CAPI) form: surveyors sign in instead. */
export function InterviewOnly({
  title,
  formId,
}: {
  title: string;
  formId: string;
}) {
  const t = useTranslations("interviews");
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center"
      data-testid="interview-only"
    >
      <ClipboardList className="size-10 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{title}</p>
      <h1 className="text-xl font-semibold">{t("onlyTitle")}</h1>
      <p>{t("onlyDescription")}</p>
      <Button asChild>
        <Link href={`/interviews/${formId}`}>{t("openInterview")}</Link>
      </Button>
    </div>
  );
}
