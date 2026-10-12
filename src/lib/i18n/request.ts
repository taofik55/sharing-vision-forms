import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    // Single-tenant default; render dates identically on server and client.
    timeZone: "Asia/Jakarta",
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
