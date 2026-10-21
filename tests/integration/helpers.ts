import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

/** Seeded DUMMY accounts (scripts/seed.ts). */
export const DUMMY = {
  admin: "admin@formpulse.test",
  editor: "editor@formpulse.test",
  viewer: "viewer@formpulse.test",
} as const;
export const DUMMY_PASSWORD = "Password123!";
export const DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

export const PUBLIC_TABLES = [
  "workspaces",
  "profiles",
  "forms",
  "form_versions",
  "form_members",
  "responses",
  "response_answers",
  "response_drafts",
  "dashboards",
  "dashboard_shares",
  "rate_limits",
  "interview_sequences",
  "response_photos",
  "response_screenouts",
  "response_archive",
] as const satisfies readonly (keyof Database["public"]["Tables"])[];

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error(
      "Integration tests need .env.local with a running Supabase (pnpm db:start && pnpm seed).",
    );
  }
  return { url, key };
}

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export function anonClient(): SupabaseClient<Database> {
  const { url, key } = env();
  return createClient<Database>(url, key, noPersist);
}

export function adminClient() {
  env();
  return createAdminClient();
}

export async function signedInClient(email: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: DUMMY_PASSWORD,
  });
  if (error || !data.user)
    throw new Error(`Sign-in failed for ${email}: ${error?.message}`);
  return { client, userId: data.user.id };
}

/** Signs in and returns the Cookie header @supabase/ssr would set in a browser. */
export async function sessionCookieHeader(email: string): Promise<string> {
  const { url, key } = env();
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) =>
        cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: DUMMY_PASSWORD,
  });
  if (error) throw error;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function profileId(email: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (error) throw error;
  return data.id;
}
