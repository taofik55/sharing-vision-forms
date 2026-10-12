import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests talk to the Supabase project configured in .env.local
// (the local stack by default, see docs/progress.md).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // 'server-only' throws outside the react-server condition; tests are server-side.
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration suites share seeded accounts; keep files sequential.
    fileParallelism: false,
  },
});
