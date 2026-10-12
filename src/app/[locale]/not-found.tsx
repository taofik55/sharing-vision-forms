import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/status-page";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <StatusPage
      code="404"
      icon={<FileQuestion className="size-10" aria-hidden />}
      title={t("notFoundTitle")}
      description={t("notFoundDescription")}
      fullScreen
    />
  );
}
