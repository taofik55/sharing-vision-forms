import { ShieldX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatusPage } from "@/components/status-page";

// Rendered (with HTTP 403) when forbidden() is called below the (app) layout.
export default async function Forbidden() {
  const t = await getTranslations("errors");
  return (
    <StatusPage
      code="403"
      icon={<ShieldX className="size-10" aria-hidden />}
      title={t("forbiddenTitle")}
      description={t("forbiddenDescription")}
    />
  );
}
