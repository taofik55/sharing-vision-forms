import type { NextRequest } from "next/server";
import { z } from "zod";
import { demoToolsUser, isDemoForm } from "@/lib/demo/access";
import { createClient } from "@/lib/supabase/server";

// Scale page only (admin + ENABLE_DEMO_TOOLS=true + demo form): runs one
// dashboard RPC as the signed-in admin and reports how long the call took on
// the server (API -> database), so the performance panel can separate server
// time from the browser round trip.
export const dynamic = "force-dynamic";

const FUNCTIONS = [
  "dashboard_bundle",
  "cross_stats",
  "cross_suggestions",
  "question_text_answers",
] as const;

const body = z.object({
  fn: z.enum(FUNCTIONS),
  args: z
    .record(z.string(), z.unknown())
    .refine((a) => typeof a.p_form_id === "string"),
});

export async function POST(request: NextRequest) {
  const user = await demoToolsUser();
  if (!user) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "bad_request" }, { status: 400 });
  const formId = parsed.data.args.p_form_id as string;
  if (!z.uuid().safeParse(formId).success || !(await isDemoForm(formId))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const started = performance.now();
  const { data, error } = await supabase.rpc(
    parsed.data.fn,
    parsed.data.args as never,
  );
  const serverMs = performance.now() - started;
  if (error)
    return Response.json({ error: error.code ?? "rpc_error" }, { status: 500 });
  return Response.json(
    { data, serverMs: Math.round(serverMs * 10) / 10 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
