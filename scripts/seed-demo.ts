/**
 * Demo dashboard data (idempotent):
 *   pnpm seed:demo                 # 300 responses over the last 30 days
 *   pnpm seed:demo --n 1000 --days 60
 *   pnpm seed:demo --allow-remote  # non-local project (think twice)
 *
 * Creates "Customer Satisfaction Survey (Demo)" (see src/lib/demo), publishes
 * it, shares it with the dummy viewer and calls the SQL generator
 * generate_demo_responses() in chunks. All rows have is_demo = true.
 * Requires `pnpm seed` first (the dummy editor owns the form).
 */
import {
  clearDemo,
  DEMO_FORMS,
  ensureDemoForm,
  generateDemo,
} from "../src/lib/demo/server";
import { createAdminClient } from "../src/lib/supabase/admin";

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

  const form = await ensureDemoForm(admin, {
    ...DEMO_FORMS.survey,
    ownerId: owner.id,
  });
  if (viewer) {
    await admin
      .from("form_members")
      .upsert(
        { form_id: form.id, user_id: viewer.id, role: "viewer" },
        { onConflict: "form_id,user_id" },
      );
  }

  const removed = await clearDemo(admin, form.id);

  const started = Date.now();
  await generateDemo(admin, form.id, n, days, (done) => {
    if (n > 2500) process.stdout.write(`\r${done} / ${n}`);
  });
  if (n > 2500) process.stdout.write("\n");

  console.log(`\nDemo data in ${url}`);
  console.table([
    {
      form: DEMO_FORMS.survey.title,
      slug: DEMO_FORMS.survey.slug,
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
