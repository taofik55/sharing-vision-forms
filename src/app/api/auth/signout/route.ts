import { hasLocale } from "next-intl";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { routing } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";

/**
 * Signs out users whose profile was deactivated. Rendering code cannot clear
 * cookies, so requireUser() redirects here. Active users are not signed out,
 * which keeps this GET endpoint harmless if linked from elsewhere.
 */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("locale");
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const user = await getCurrentUser();
  if (user?.isActive) redirect(`/${locale}`);

  if (user) {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
    // Belt and braces: drop any leftover Supabase auth cookies.
    const cookieStore = await cookies();
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.startsWith("sb-")) cookieStore.delete(cookie.name);
    }
    redirect(`/${locale}/login?error=inactive`);
  }

  redirect(`/${locale}/login`);
}
