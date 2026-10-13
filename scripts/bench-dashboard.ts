/**
 * Dashboard benchmark (local / staging only):
 *   pnpm bench:dashboard                          # 1k, 10k, 50k, 100k responses
 *   pnpm bench:dashboard --sizes 1000,10000 --runs 30
 *   pnpm bench:dashboard --keep                   # do not clear demo rows first
 *   pnpm bench:dashboard --settle 0                # no pause before measuring
 *
 * Uses the scale demo form ("Scale test (Demo)", owned by admin@formpulse.test),
 * grows it to each size with generate_demo_responses (in chunks, 90-day
 * spread) and times every dashboard RPC as the signed-in admin through the
 * API (PostgREST: HTTP + auth + permission checks included). Prints Markdown
 * tables for docs/scale-report.md. Refuses non-local targets.
 */
import { createClient } from "@supabase/supabase-js";
import {
  clearDemo,
  DEMO_FORMS,
  ensureDemoForm,
  generateDemo,
} from "../src/lib/demo/server";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) {
  console.error(`Refusing to benchmark a non-local project (${url}).`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sizes = (arg("sizes") ?? "1000,10000,50000,100000")
  .split(",")
  .map(Number);
const runs = Number(arg("runs") ?? 20);
const days = Number(arg("days") ?? 90);
// Seconds to wait after generating, so autovacuum / analyze of the bulk insert
// does not overlap the measurements.
const settle = Number(arg("settle") ?? 30);
const email = process.env.BENCH_EMAIL ?? "admin@formpulse.test";
const password = process.env.BENCH_PASSWORD ?? "Password123!";

type Timing = {
  name: string;
  p50: number;
  p95: number;
  max: number;
  bytes: number;
};

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

async function main() {
  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .single();
  if (!owner) throw new Error(`${email} not found. Run pnpm seed first.`);
  const form = await ensureDemoForm(admin, {
    ...DEMO_FORMS.scale,
    ownerId: owner.id,
  });

  const user = createClient<Database>(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  const { error: signInError } = await user.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  // Question keys for filtered / cross calls.
  const { data: formRow } = await admin
    .from("forms")
    .select("current_version_id")
    .eq("id", form.id)
    .single();
  const { data: version } = await admin
    .from("form_versions")
    .select("definition")
    .eq("id", formRow!.current_version_id!)
    .single();
  type Q = { key: string; type: string; options?: { id: string }[] };
  const definition = version!.definition as unknown as {
    sections: { questions: Q[] }[];
  };
  const qs = definition.sections.flatMap((s) => s.questions);
  const dropdown = qs.find((q) => q.type === "dropdown")!;
  const rating = qs.find((q) => q.type === "rating")!;

  const DAY = 86_400_000;
  const jakartaToday =
    Math.floor((Date.now() + 7 * 3600_000) / DAY) * DAY - 7 * 3600_000;
  const last30 = {
    from: new Date(jakartaToday - 29 * DAY).toISOString(),
    to: new Date(jakartaToday + DAY).toISOString(),
  };

  const calls: [
    string,
    () => PromiseLike<{ data: unknown; error: unknown }>,
  ][] = [
    [
      "dashboard_bundle (no filters)",
      () => user.rpc("dashboard_bundle", { p_form_id: form.id, p_filters: {} }),
    ],
    [
      "dashboard_bundle (last 30 days)",
      () =>
        user.rpc("dashboard_bundle", { p_form_id: form.id, p_filters: last30 }),
    ],
    [
      "dashboard_bundle (device = mobile)",
      () =>
        user.rpc("dashboard_bundle", {
          p_form_id: form.id,
          p_filters: { device: "mobile" },
        }),
    ],
    [
      "dashboard_bundle (answer filter)",
      () =>
        user.rpc("dashboard_bundle", {
          p_form_id: form.id,
          p_filters: {
            answers: [
              {
                questionKey: dropdown.key,
                operator: "any_of",
                values: [dropdown.options![0].id],
              },
            ],
          },
        }),
    ],
    [
      "question_stats (rating)",
      () =>
        user.rpc("question_stats", {
          p_form_id: form.id,
          p_question_key: rating.key,
          p_filters: {},
        }),
    ],
    [
      "cross_stats (dropdown x rating)",
      () =>
        user.rpc("cross_stats", {
          p_form_id: form.id,
          p_question_a: dropdown.key,
          p_question_b: rating.key,
          p_filters: {},
        }),
    ],
    [
      "cross_suggestions",
      () =>
        user.rpc("cross_suggestions", { p_form_id: form.id, p_filters: {} }),
    ],
    [
      "list_responses (first page)",
      () => user.rpc("list_responses", { p_form_id: form.id, p_filters: {} }),
    ],
    [
      "export_responses (batch of 1000)",
      () =>
        user.rpc("export_responses", {
          p_form_id: form.id,
          p_filters: {},
          p_limit: 1000,
        }),
    ],
  ];

  if (!process.argv.includes("--keep")) {
    await clearDemo(admin, form.id);
  }
  const { count: startCount } = await admin
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("form_id", form.id);
  let current = startCount ?? 0;

  const report: string[] = [];
  for (const size of sizes) {
    if (size > current) {
      const started = Date.now();
      await generateDemo(admin, form.id, size - current, days, (done) =>
        process.stdout.write(`\rgenerating ${current + done} / ${size}`),
      );
      process.stdout.write("\n");
      report.push(
        `Generated ${size - current} responses (to ${size}) in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
      );
      current = size;
    }

    if (settle > 0) await new Promise((r) => setTimeout(r, settle * 1000));
    const results: Timing[] = [];
    for (const [name, call] of calls) {
      const times: number[] = [];
      let bytes = 0;
      for (let i = 0; i < runs + 3; i++) {
        const t0 = performance.now();
        const { data, error } = await call();
        const ms = performance.now() - t0;
        if (error) throw new Error(`${name}: ${JSON.stringify(error)}`);
        if (i >= 3) times.push(ms);
        bytes = JSON.stringify(data).length;
      }
      results.push({
        name,
        p50: percentile(times, 50),
        p95: percentile(times, 95),
        max: Math.max(...times),
        bytes,
      });
      process.stdout.write(
        `  ${size}: ${name} p95 ${percentile(times, 95).toFixed(0)} ms\n`,
      );
    }

    report.push(
      "",
      `### ${size.toLocaleString("en-US")} responses`,
      "",
      `| Call | p50 (ms) | p95 (ms) | max (ms) | payload |`,
      `| --- | ---: | ---: | ---: | ---: |`,
      ...results.map(
        (r) =>
          `| ${r.name} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.max.toFixed(0)} | ${(r.bytes / 1024).toFixed(1)} KB |`,
      ),
    );
  }

  console.log(
    `\n## Results (${runs} runs per call after 3 warm-ups, ${new Date().toISOString()})\n`,
  );
  console.log(report.join("\n"));
}

main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
