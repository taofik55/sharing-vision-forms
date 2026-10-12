import "server-only";
import { createHmac } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

/** Limits per fixed window (seconds). */
export const RATE_LIMITS = {
  /** Submissions per IP per form. */
  submitPerForm: { limit: 10, windowSeconds: 600 },
  /** Submissions per IP across all forms. */
  submitGlobal: { limit: 60, windowSeconds: 600 },
  /** Draft saves per IP (autosave runs every ~5 s). */
  draft: { limit: 240, windowSeconds: 600 },
} as const;

/**
 * Client IP. The hosting proxy must overwrite these headers (Vercel does);
 * otherwise clients could spoof them to dodge rate limits.
 */
export function getClientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** Salted HMAC of the IP (+ scope). Raw IPs are never stored. */
export function hashIp(ip: string, scope = ""): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT is not set");
  return createHmac("sha256", salt)
    .update(`${ip}|${scope}`)
    .digest("base64url")
    .slice(0, 32);
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** True while the bucket is within its limit. Fails open only on infrastructure errors. */
export async function checkRateLimit(
  admin: AdminClient,
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("check_rate_limit failed", error.code);
    return true;
  }
  return data === true;
}
