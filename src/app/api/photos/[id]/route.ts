import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Interview photos for people who can view the form (RLS helper inside the RPC).
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/photos/[id]">,
) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response(null, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_response_photo", { p_photo_id: id })
    .maybeSingle();
  if (error || !data) return new Response(null, { status: 404 });
  // bytea arrives as "\x<hex>".
  const hex = String(data.data).replace(/^\\x/, "");
  const bytes = Buffer.from(hex, "hex");
  return new Response(bytes, {
    headers: {
      "Content-Type": data.mime,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
