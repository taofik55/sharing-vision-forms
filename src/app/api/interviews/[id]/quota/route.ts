import type { NextRequest } from "next/server";
import { z } from "zod";
import { quotaCell } from "@/lib/forms/capi";
import type { QuotaStatus } from "@/lib/forms/interview";
import { interviewer, loadInterviewForm } from "@/lib/forms/interview-server";
import type { Answers } from "@/lib/forms/logic";
import { createAdminClient } from "@/lib/supabase/admin";

// Live quota check during an interview (after the configured question).
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  answers: z.record(z.string().max(64), z.unknown()),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/interviews/[id]/quota">,
) {
  const { id } = await ctx.params;
  if (!(await interviewer(id)))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const form = await loadInterviewForm(id);
  if (!form) return Response.json({ error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "bad_request" }, { status: 400 });

  const quota = form.settings.quota;
  const cell = quotaCell(form.settings, parsed.data.answers as Answers);
  let count = 0;
  if (cell) {
    const { data } = await createAdminClient().rpc("quota_count", {
      p_form_id: form.id,
      p_cell: cell,
    });
    count = data ?? 0;
  }
  const body: QuotaStatus = {
    cell,
    count,
    target: quota.enabled ? quota.target : null,
    reserve: quota.enabled ? quota.reserve : 0,
    full:
      quota.enabled && cell !== null && count >= quota.target + quota.reserve,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
