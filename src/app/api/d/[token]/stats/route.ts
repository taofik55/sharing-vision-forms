import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  getClientIp,
  hashIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  parsePublicCall,
  publicFilters,
  resolveShare,
  runPublicCall,
  SHARE_TOKEN,
} from "@/lib/shares/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public (no auth): read-only dashboard data for an active share token. The
// secret key is used only after the token resolved to a form, and every call
// is scoped to that form (whitelisted RPCs, date range only).
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/d/[token]/stats">,
) {
  const { token } = await ctx.params;
  if (!SHARE_TOKEN.test(token)) return json({ error: "not_found" }, 404);

  const allowed = await checkRateLimit(
    createAdminClient(),
    `share:${hashIp(getClientIp(request.headers), token)}`,
    RATE_LIMITS.publicDashboard,
  );
  if (!allowed) return json({ error: "rate_limited" }, 429);

  const share = await resolveShare(token);
  if (!share) return json({ error: "not_found" }, 404);

  const params = request.nextUrl.searchParams;
  const call = parsePublicCall(params);
  if (!call) return json({ error: "bad_request" }, 400);

  const { status, body } = await runPublicCall(
    share,
    call,
    publicFilters(params),
  );
  return json(body, status);
}
