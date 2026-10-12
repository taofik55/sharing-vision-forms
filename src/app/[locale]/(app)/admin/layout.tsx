import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/session";

// Every /admin/* page is admin-only. Non-admins get the 403 page.
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["admin"]);
  return children;
}
