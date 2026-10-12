import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, requireEnv } from "../env";
import type { Database } from "../../types/database";

/**
 * Privileged Supabase client. Bypasses RLS.
 *
 * This is the ONLY module allowed to read SUPABASE_SECRET_KEY. Use it only
 * from server code after the caller has been authorized explicitly
 * (admin server actions, public /api/f routes, seed script).
 */
export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  const secretKey = requireEnv(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY,
  );

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
