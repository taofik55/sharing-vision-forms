import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components is intentionally off: every app page reads the Supabase
  // session cookie, so pages are request-time rendered. Revisit if/when public
  // pages need a static shell. See docs/progress.md (Phase 1 decisions).
  experimental: {
    // Enables forbidden() + forbidden.tsx for real HTTP 403 pages.
    authInterrupts: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
