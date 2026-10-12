import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Requires a seeded Supabase project in .env.local (pnpm db:start && pnpm seed).
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Dev server compiles routes on first hit.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/id/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
