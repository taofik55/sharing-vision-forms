import { routing, type Locale } from "@/lib/i18n/routing";

export const LOGIN_PATH = "/login";

/** Splits "/en/forms/1" into { locale: "en", path: "/forms/1" }. */
export function splitLocale(pathname: string): {
  locale: Locale | null;
  path: string;
} {
  const segments = pathname.split("/");
  const candidate = segments[1];
  if ((routing.locales as readonly string[]).includes(candidate)) {
    const rest = segments.slice(2).join("/");
    return { locale: candidate as Locale, path: `/${rest}` };
  }
  return { locale: null, path: pathname || "/" };
}

/** Paths (without locale prefix) that never require a session. */
export function isPublicPath(path: string): boolean {
  return (
    path === LOGIN_PATH ||
    path.startsWith(`${LOGIN_PATH}/`) ||
    path.startsWith("/f/") ||
    path.startsWith("/d/")
  );
}

/**
 * Accepts only same-origin relative paths for post-login redirects, to avoid
 * open redirects (e.g. "//evil.com" or "/\\evil.com").
 */
export function safeNextPath(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048)
    return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
