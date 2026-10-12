import { getLocale } from "next-intl/server";
import { requireFormAccess } from "@/lib/forms/access";
import { redirect } from "@/lib/i18n/navigation";

export default async function FormIndexPage({
  params,
}: PageProps<"/[locale]/forms/[id]">) {
  const { id } = await params;
  const { canEdit } = await requireFormAccess(id, "view");
  return redirect({
    href: `/forms/${id}/${canEdit ? "builder" : "dashboard"}`,
    locale: await getLocale(),
  });
}
