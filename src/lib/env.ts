// Public env vars must be referenced literally so Next.js can inline them in
// client bundles. Server-only secrets are read in src/lib/supabase/admin.ts.

export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function getSupabasePublicEnv() {
  return {
    url: requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    publishableKey: requireEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

export function isDemoToolsEnabled(): boolean {
  return process.env.ENABLE_DEMO_TOOLS === "true";
}
