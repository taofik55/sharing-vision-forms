/**
 * Demo dashboard data (idempotent):
 *   pnpm seed:demo                 # 300 responses over the last 30 days
 *   pnpm seed:demo --n 1000 --days 60
 *   pnpm seed:demo --allow-remote  # non-local project (think twice)
 *
 * Creates "Customer Satisfaction Survey (Demo)" from the template (plus a
 * waiting-time and an age question so cross-question insights have something
 * to find), publishes it, shares it with the dummy viewer and calls the SQL
 * generator generate_demo_responses(). All rows have is_demo = true.
 * Requires `pnpm seed` first (the dummy editor owns the form).
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import { newId } from "../src/lib/forms/operations";
import type { FormDefinition, Question } from "../src/lib/forms/schema";
import { instantiateTemplate } from "../src/lib/forms/templates";
import type { Json } from "../src/types/database";

const DEMO_SLUG = "demo-customer-satisfaction";
const DEMO_TITLE = "Customer Satisfaction Survey (Demo)";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url) &&
    !process.argv.includes("--allow-remote")
  ) {
    console.error(
      `Refusing to write demo data to a non-local project (${url}). Use --allow-remote.`,
    );
    process.exit(1);
  }
  return url;
}

function demoDefinition(): FormDefinition {
  const definition = instantiateTemplate(
    "customer_satisfaction",
    "en",
  ).definition;
  const extra: Question[] = [
    {
      id: newId(),
      key: newId(),
      type: "number",
      title: "How long did you wait to be served? (minutes)",
      required: true,
      validation: { min: 0, max: 120, integerOnly: true },
    },
    {
      id: newId(),
      key: newId(),
      type: "number",
      title: "Your age",
      required: true,
      validation: { min: 16, max: 90, integerOnly: true },
    },
  ];
  // Insert before "How many times did you visit…" so the generator treats
  // waiting time as number #1 (lowers ratings) and age as number #2 (by channel).
  const about = definition.sections[0];
  const visitsIndex = about.questions.findIndex((q) => q.type === "number");
  about.questions.splice(visitsIndex, 0, ...extra);
  return definition;
}

async function main() {
  const url = assertTarget();
  const n = arg("n", 300);
  const days = arg("days", 30);
  const admin = createAdminClient();

  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("email", "editor@formpulse.test")
    .maybeSingle();
  if (!owner) throw new Error("Dummy editor not found. Run `pnpm seed` first.");
  const { data: viewer } = await admin
    .from("profiles")
    .select("id")
    .eq("email", "viewer@formpulse.test")
    .maybeSingle();

  let { data: form } = await admin
    .from("forms")
    .select("id, current_version_id")
    .eq("slug", DEMO_SLUG)
    .maybeSingle();

  if (!form) {
    const definition = demoDefinition() as unknown as NonNullable<Json>;
    const { data: created, error } = await admin
      .from("forms")
      .insert({
        workspace_id: WORKSPACE_ID,
        owner_id: owner.id,
        title: DEMO_TITLE,
        description:
          "Synthetic data for exploring the dashboard. Not real people.",
        slug: DEMO_SLUG,
        draft_definition: definition,
        thank_you_message: "Thank you for your feedback!",
        is_demo: true,
      })
      .select("id, current_version_id")
      .single();
    if (error) throw error;
    const { data: version, error: vError } = await admin
      .from("form_versions")
      .insert({
        form_id: created.id,
        version_number: 1,
        definition,
        published_by: owner.id,
      })
      .select("id")
      .single();
    if (vError) throw vError;
    const { error: pError } = await admin
      .from("forms")
      .update({ current_version_id: version.id, status: "published" })
      .eq("id", created.id);
    if (pError) throw pError;
    form = { id: created.id, current_version_id: version.id };
  } else {
    await admin.from("forms").update({ status: "published" }).eq("id", form.id);
  }

  if (viewer) {
    await admin
      .from("form_members")
      .upsert(
        { form_id: form.id, user_id: viewer.id, role: "viewer" },
        { onConflict: "form_id,user_id" },
      );
  }

  const { data: removed, error: delError } = await admin.rpc(
    "delete_demo_responses",
    { p_form_id: form.id },
  );
  if (delError) throw delError;

  const started = Date.now();
  const { error: genError } = await admin.rpc("generate_demo_responses", {
    p_form_id: form.id,
    p_n: n,
    p_days: days,
  });
  if (genError) throw genError;
  // Fresh planner statistics after the bulk insert.
  const { error: analyzeError } = await admin.rpc("analyze_response_tables");
  if (analyzeError) throw analyzeError;

  console.log(`\nDemo data in ${url}`);
  console.table([
    {
      form: DEMO_TITLE,
      slug: DEMO_SLUG,
      removed: removed ?? 0,
      generated: n,
      days,
      seconds: ((Date.now() - started) / 1000).toFixed(1),
    },
  ]);
  console.log(
    `Dashboard: /forms/${form.id}/dashboard (editor@formpulse.test, viewer@formpulse.test)`,
  );
}

main().catch((error: unknown) => {
  console.error("Demo seed failed:", error);
  process.exit(1);
});
