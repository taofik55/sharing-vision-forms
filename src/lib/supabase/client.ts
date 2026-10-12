import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/** Supabase client for Client Components (internal, logged-in users only). */
export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
