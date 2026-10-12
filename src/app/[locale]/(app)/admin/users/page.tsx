import type { Metadata } from "next";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { requireRole } from "@/lib/auth/session";
import type { Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { CreateUserDialog } from "./create-user-dialog";
import { UsersTable, type UserRow } from "./users-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers");
  return { title: t("title") };
}

// TODO(phase-later): server-side pagination once workspaces have many users.
const MAX_USERS = 500;

export default async function AdminUsersPage({
  params,
}: PageProps<"/[locale]/admin/users">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const me = await requireRole(["admin"]);
  const t = await getTranslations("adminUsers");
  const format = await getFormatter();

  // RLS: admins can read every profile in their workspace.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at")
    .order("created_at", { ascending: true })
    .limit(MAX_USERS);
  if (error) throw new Error("Failed to load users");

  const rows: UserRow[] = (data ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    isActive: p.is_active,
    createdAtLabel: format.dateTime(new Date(p.created_at), {
      dateStyle: "medium",
    }),
    isSelf: p.id === me.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <CreateUserDialog />
      </div>
      <UsersTable rows={rows} />
    </div>
  );
}
