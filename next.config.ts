import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

// Basic security headers. App pages and shared dashboards must not be framed
// (clickjacking); public forms (/<locale>/f/...) may be embedded in other sites.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];
const noFraming = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // exceljs (XLSX export) is a Node library; keep it out of the bundle.
  serverExternalPackages: ["exceljs"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/((?!(?:id|en)/f/).*)", headers: noFraming },
    ];
  },
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
