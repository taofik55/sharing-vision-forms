"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createUserSchema,
  setActiveSchema,
  updateRoleSchema,
  type AdminActionResult,
} from "@/lib/users/schema";

const USERS_PAGE = "/[locale]/admin/users";
// Effectively permanent ban while a profile is inactive (GoTrue duration syntax).
const BAN_DURATION = "876000h";

/** Server-side authorization. Never trust the client to say it is an admin. */
async function getActiveAdmin(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user && user.isActive && user.role === "admin" ? user : null;
}

export async function createUserAction(
  input: unknown,
): Promise<AdminActionResult> {
  const admin = await getActiveAdmin();
  if (!admin) return { ok: false, error: "notAllowed" };

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { email, fullName, role, password } = parsed.data;

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
    app_metadata: { role },
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || error?.status === 422) {
      return { ok: false, error: "emailTaken" };
    }
    console.error(
      "createUserAction: auth.admin.createUser failed",
      error?.code,
    );
    return { ok: false, error: "generic" };
  }

  // The auth trigger creates the profile as 'viewer'; set the chosen role explicitly.
  const { error: profileError } = await adminClient
    .from("profiles")
    .update({ role, full_name: fullName })
    .eq("id", data.user.id);
  if (profileError) {
    console.error("createUserAction: profile update failed", profileError.code);
    return { ok: false, error: "generic" };
  }

  revalidatePath(USERS_PAGE, "page");
  return { ok: true };
}

export async function updateUserRoleAction(
  input: unknown,
): Promise<AdminActionResult> {
  const admin = await getActiveAdmin();
  if (!admin) return { ok: false, error: "notAllowed" };

  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { userId, role } = parsed.data;
  if (userId === admin.id) return { ok: false, error: "cannotChangeSelf" };

  // Runs as the admin user: RLS + profiles_guard enforce the rules again in Postgres.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data?.length) return { ok: false, error: "notFound" };

  revalidatePath(USERS_PAGE, "page");
  return { ok: true };
}

export async function setUserActiveAction(
  input: unknown,
): Promise<AdminActionResult> {
  const admin = await getActiveAdmin();
  if (!admin) return { ok: false, error: "notAllowed" };

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { userId, active } = parsed.data;
  if (userId === admin.id) return { ok: false, error: "cannotChangeSelf" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data?.length) return { ok: false, error: "notFound" };

  // Also block sign-in / token refresh at the auth layer.
  const { error: banError } =
    await createAdminClient().auth.admin.updateUserById(userId, {
      ban_duration: active ? "none" : BAN_DURATION,
    });
  if (banError)
    console.error("setUserActiveAction: ban update failed", banError.code);

  revalidatePath(USERS_PAGE, "page");
  return { ok: true };
}
