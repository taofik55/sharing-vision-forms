import "server-only";
import { forbidden, redirect as nextRedirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { redirect } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "./roles";
import { LOGIN_PATH } from "./paths";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: AppRole;
  isActive: boolean;
  locale: string;
};

/**
 * Data Access Layer entry point. Verifies the session server-side and loads
 * the caller's profile. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, locale")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    isActive: profile.is_active,
    locale: profile.locale,
  };
});

/** For pages under (app): redirects to login if signed out, signs out inactive users. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) {
    return redirect({ href: LOGIN_PATH, locale });
  }
  if (!user.isActive) {
    // Cookies cannot be cleared while rendering; a route handler signs out.
    nextRedirect(`/api/auth/signout?reason=inactive&locale=${locale}`);
  }
  return user;
}

/** Renders the 403 page (HTTP 403) when the caller lacks one of the roles. */
export async function requireRole(
  roles: readonly AppRole[],
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) forbidden();
  return user;
}
