import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";

// Friendly 404 for respondents (no link into the internal app).
export default async function PublicFormNotFound() {
  const t = await getTranslations("publicForm");
  return (
    <PublicShell>
      <div
        className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center"
        data-testid="form-not-found"
      >
        <FileQuestion className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("notFoundDescription")}</p>
      </div>
    </PublicShell>
  );
}
