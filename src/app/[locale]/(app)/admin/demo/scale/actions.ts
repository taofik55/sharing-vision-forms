"use server";

import { z } from "zod";
import { demoToolsUser, isDemoForm } from "@/lib/demo/access";
import {
  DEMO_CHUNK,
  DEMO_FORMS,
  deleteDemoChunk,
  ensureDemoForm,
  generateDemoChunk,
} from "@/lib/demo/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Scale demo tools. Every action re-checks: admin, ENABLE_DEMO_TOOLS=true and
// (for writes) that the target form is a demo form. Rows are generated inside
// the database (generate_demo_responses), never row by row from Node. Long
// jobs are split into short calls driven by the browser (serverless limits).

export type DemoResult<T> =
  { ok: true; data: T } | { ok: false; error: "notAllowed" | "generic" };

const notAllowed = { ok: false, error: "notAllowed" } as const;

export async function setupScaleFormAction(): Promise<
  DemoResult<{ formId: string }>
> {
  const user = await demoToolsUser();
  if (!user) return notAllowed;
  try {
    const form = await ensureDemoForm(createAdminClient(), {
      ...DEMO_FORMS.scale,
      ownerId: user.id,
    });
    return { ok: true, data: { formId: form.id } };
  } catch (error) {
    console.error("setupScaleFormAction", error);
    return { ok: false, error: "generic" };
  }
}

const batchInput = z.object({
  formId: z.uuid(),
  n: z.number().int().min(1).max(DEMO_CHUNK),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});

/** One generator chunk (<= DEMO_CHUNK responses). Returns the database time. */
export async function generateDemoBatchAction(
  input: unknown,
): Promise<DemoResult<{ ms: number }>> {
  const user = await demoToolsUser();
  const parsed = batchInput.safeParse(input);
  if (!user || !parsed.success || !(await isDemoForm(parsed.data.formId)))
    return notAllowed;
  const started = performance.now();
  try {
    await generateDemoChunk(
      createAdminClient(),
      parsed.data.formId,
      parsed.data.n,
      parsed.data.days,
    );
    return { ok: true, data: { ms: Math.round(performance.now() - started) } };
  } catch (error) {
    console.error("generateDemoBatchAction", error);
    return { ok: false, error: "generic" };
  }
}

/** Fresh planner statistics after a bulk generation or cleanup. */
export async function analyzeDemoAction(): Promise<DemoResult<null>> {
  if (!(await demoToolsUser())) return notAllowed;
  const { error } = await createAdminClient().rpc("analyze_response_tables");
  return error ? { ok: false, error: "generic" } : { ok: true, data: null };
}

/** Deletes up to 20,000 demo responses (only is_demo rows). */
export async function clearDemoBatchAction(
  formId: unknown,
): Promise<DemoResult<{ deleted: number }>> {
  const user = await demoToolsUser();
  const id = z.uuid().safeParse(formId);
  if (!user || !id.success || !(await isDemoForm(id.data))) return notAllowed;
  try {
    return {
      ok: true,
      data: { deleted: await deleteDemoChunk(createAdminClient(), id.data) },
    };
  } catch (error) {
    console.error("clearDemoBatchAction", error);
    return { ok: false, error: "generic" };
  }
}

const simulateInput = z.object({
  formId: z.uuid(),
  rate: z.union([z.literal(1), z.literal(5), z.literal(20)]),
});

/**
 * Live simulator tick: `rate` responses submitted now. The browser calls this
 * once per second (serverless functions cannot run long loops), so closing
 * the tab stops the simulation.
 */
export async function simulateDemoAction(
  input: unknown,
): Promise<DemoResult<{ ms: number }>> {
  const user = await demoToolsUser();
  const parsed = simulateInput.safeParse(input);
  if (!user || !parsed.success || !(await isDemoForm(parsed.data.formId)))
    return notAllowed;
  const started = performance.now();
  try {
    await generateDemoChunk(
      createAdminClient(),
      parsed.data.formId,
      parsed.data.rate,
      1,
      true,
    );
    return { ok: true, data: { ms: Math.round(performance.now() - started) } };
  } catch (error) {
    console.error("simulateDemoAction", error);
    return { ok: false, error: "generic" };
  }
}
