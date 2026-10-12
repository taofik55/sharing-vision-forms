import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/status-page";

// notFound() below the (app) layout renders inside the app shell.
export default async function AppNotFound() {
  const t = await getTranslations("errors");
  return (
    <StatusPage
      code="404"
      icon={<FileQuestion className="size-10" aria-hidden />}
      title={t("notFoundTitle")}
      description={t("notFoundDescription")}
    />
  );
}
