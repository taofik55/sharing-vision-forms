import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { demoDefinition } from "./definition";
import { DEMO_CHUNK, DEMO_DELETE_CHUNK } from "./limits";

type AdminClient = ReturnType<typeof createAdminClient>;

export const DEMO_FORMS = {
  /** `pnpm seed:demo` (owned by the dummy editor, shared with the dummy viewer). */
  survey: {
    slug: "demo-customer-satisfaction",
    title: "Customer Satisfaction Survey (Demo)",
  },
  /** /admin/demo/scale (owned by the admin who opens the page first). */
  scale: { slug: "demo-scale-test", title: "Scale test (Demo)" },
} as const;

export { DEMO_CHUNK, DEMO_DELETE_CHUNK } from "./limits";

/** Creates (or re-publishes) a published demo form with is_demo = true. */
export async function ensureDemoForm(
  admin: AdminClient,
  { slug, title, ownerId }: { slug: string; title: string; ownerId: string },
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await admin
    .from("forms")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    await admin
      .from("forms")
      .update({ status: "published", is_demo: true })
      .eq("id", existing.id);
    return { id: existing.id, created: false };
  }

  const { data: owner, error: ownerError } = await admin
    .from("profiles")
    .select("workspace_id")
    .eq("id", ownerId)
    .single();
  if (ownerError) throw ownerError;

  const definition = demoDefinition() as unknown as NonNullable<Json>;
  const { data: created, error } = await admin
    .from("forms")
    .insert({
      workspace_id: owner.workspace_id,
      owner_id: ownerId,
      title,
      description:
        "Synthetic data for exploring the dashboard. Not real people.",
      slug,
      draft_definition: definition,
      thank_you_message: "Thank you for your feedback!",
      is_demo: true,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: version, error: vError } = await admin
    .from("form_versions")
    .insert({
      form_id: created.id,
      version_number: 1,
      definition,
      published_by: ownerId,
    })
    .select("id")
    .single();
  if (vError) throw vError;
  const { error: pError } = await admin
    .from("forms")
    .update({ current_version_id: version.id, status: "published" })
    .eq("id", created.id);
  if (pError) throw pError;
  return { id: created.id, created: true };
}

/** One cleanup call; returns how many demo responses it deleted. */
export async function deleteDemoChunk(
  admin: AdminClient,
  formId: string,
): Promise<number> {
  const { data, error } = await admin.rpc("delete_demo_responses", {
    p_form_id: formId,
    p_limit: DEMO_DELETE_CHUNK,
  });
  if (error) throw error;
  return data ?? 0;
}

/** Deletes every is_demo response of the form (in chunks). */
export async function clearDemo(
  admin: AdminClient,
  formId: string,
): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await deleteDemoChunk(admin, formId);
    total += deleted;
    if (deleted < DEMO_DELETE_CHUNK) return total;
  }
}

/** One generator call (n <= DEMO_CHUNK). */
export async function generateDemoChunk(
  admin: AdminClient,
  formId: string,
  n: number,
  days: number,
  live = false,
): Promise<void> {
  const { error } = await admin.rpc("generate_demo_responses", {
    p_form_id: formId,
    p_n: n,
    p_days: days,
    p_live: live,
  });
  if (error) throw error;
}

/** Generates n responses in chunks (CLI / benchmark). */
export async function generateDemo(
  admin: AdminClient,
  formId: string,
  n: number,
  days: number,
  onProgress?: (done: number) => void,
): Promise<void> {
  for (let done = 0; done < n; done += DEMO_CHUNK) {
    await generateDemoChunk(
      admin,
      formId,
      Math.min(DEMO_CHUNK, n - done),
      days,
    );
    onProgress?.(Math.min(n, done + DEMO_CHUNK));
  }
  // Fresh planner statistics after bulk inserts.
  const { error } = await admin.rpc("analyze_response_tables");
  if (error) throw error;
}
