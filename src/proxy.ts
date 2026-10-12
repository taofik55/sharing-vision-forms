import { createServerClient, type CookieOptions } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH, isPublicPath, splitLocale } from "@/lib/auth/paths";
import { getSupabasePublicEnv } from "@/lib/env";
import { routing } from "@/lib/i18n/routing";
import type { Database } from "@/types/database";

const handleI18nRouting = createIntlMiddleware(routing);

/**
 * 1. Refreshes the Supabase session (writes rotated cookies to the request so
 *    Server Components see them, and to the response so the browser keeps them).
 * 2. Redirects signed-out users away from protected pages to /{locale}/login.
 * 3. Delegates locale detection/prefixing to next-intl.
 *
 * This is a UX gate only. Pages, actions and RLS re-check authorization.
 */
export async function proxy(request: NextRequest) {
  const pendingCookies: {
    name: string;
    value: string;
    options: CookieOptions;
  }[] = [];
  let cacheHeaders: Record<string, string> = {};

  const { url, publishableKey } = getSupabasePublicEnv();
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pendingCookies.push({ name, value, options });
        }
        cacheHeaders = headers;
      },
    },
  });

  // Do not put code between client creation and getClaims(): it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  const { locale, path } = splitLocale(request.nextUrl.pathname);
  let response: NextResponse;

  if (locale && !isSignedIn && !isPublicPath(path)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `/${locale}${LOGIN_PATH}`;
    loginUrl.search = "";
    if (path !== "/")
      loginUrl.searchParams.set("next", `${path}${request.nextUrl.search}`);
    response = NextResponse.redirect(loginUrl);
  } else if (locale && isSignedIn && path === LOGIN_PATH) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = `/${locale}`;
    homeUrl.search = "";
    response = NextResponse.redirect(homeUrl);
  } else {
    // Runs after the session refresh so forwarded request headers carry fresh cookies.
    response = handleI18nRouting(request);
  }

  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(cacheHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // Skip API routes (they authorize themselves), Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
