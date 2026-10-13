import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { isDemoToolsEnabled } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Demo tools: active admins only, and only when ENABLE_DEMO_TOOLS=true.
 * Returns null otherwise (callers answer 403 / "not allowed").
 */
export async function demoToolsUser(): Promise<CurrentUser | null> {
  if (!isDemoToolsEnabled()) return null;
  const user = await getCurrentUser();
  return user?.isActive && user.role === "admin" ? user : null;
}

/** True when the form exists and is a demo form (tools never touch real forms). */
export async function isDemoForm(formId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("forms")
    .select("is_demo")
    .eq("id", formId)
    .maybeSingle();
  return data?.is_demo === true;
}
