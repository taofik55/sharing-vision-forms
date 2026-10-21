/**
 * BRI UMKM survey (Kuesioner Survei Layanan UMKM BRI, draft v0.3):
 *   pnpm seed:bri                  # both forms; skips a form that already exists
 *   pnpm seed:bri --reset          # delete and recreate both forms
 *   pnpm seed:bri --n 300          # sample interviews in the "contoh" form
 *   pnpm seed:bri --allow-remote   # non-local project (think twice)
 *
 * Creates (owner: the dummy editor, else the first admin):
 *   1. "survei-umkm-bri"        the questionnaire, published, interview mode, no answers;
 *   2. "survei-umkm-bri-contoh" the same questionnaire with N sample interviews
 *      (default 300) by five surveyors (one per city), ~15 per quota cell,
 *      plus screen-outs, QC flags, a backcheck sample, approvals and rejects.
 * Surveyor accounts surveyor.<city>@formpulse.test (password Password123!)
 * are created and assigned to both forms.
 */
import { randomUUID } from "node:crypto";
import {
  BRI_DESCRIPTION,
  BRI_TITLE,
  briUmkmCapiSettings,
  briUmkmDefinition,
} from "../src/lib/forms/bri-umkm";
import { qcFlags, quotaCell } from "../src/lib/forms/capi";
import { prepareAnswers } from "../src/lib/forms/submission";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Json } from "../src/types/database";
import {
  CITIES,
  profileFor,
  rng,
  sampleInterview,
  sampleScreenOut,
  SAMPLE_PHOTO,
} from "./lib/bri-sample";

type Admin = ReturnType<typeof createAdminClient>;
const PASSWORD = "Password123!";
const SLUG = "survei-umkm-bri";
const SAMPLE_SLUG = "survei-umkm-bri-contoh";

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
      `Refusing to write to a non-local project (${url}). Use --allow-remote.`,
    );
    process.exit(1);
  }
  return url;
}

async function ensureUser(admin: Admin, email: string, fullName: string) {
  const perPage = 200;
  let existing: { id: string } | null = null;
  for (let page = 1; !existing; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    existing = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
    if (data.users.length < perPage) break;
  }
  let id = existing?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: "surveyor" },
      app_metadata: { role: "surveyor" },
    });
    if (error || !data.user) throw error ?? new Error(`createUser ${email}`);
    id = data.user.id;
  }
  const { error } = await admin
    .from("profiles")
    .update({ role: "surveyor", full_name: fullName, is_active: true })
    .eq("id", id);
  if (error) throw error;
  return id;
}

async function owner(
  admin: Admin,
): Promise<{ id: string; workspace_id: string }> {
  const { data: editor } = await admin
    .from("profiles")
    .select("id, workspace_id")
    .eq("email", "editor@formpulse.test")
    .maybeSingle();
  if (editor) return editor;
  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id, workspace_id")
    .eq("role", "admin")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!adminProfile)
    throw new Error("No editor or admin profile. Run `pnpm seed` first.");
  return adminProfile;
}

async function createForm(
  admin: Admin,
  slug: string,
  title: string,
  ownerProfile: { id: string; workspace_id: string },
): Promise<{ id: string; versionId: string } | null> {
  const reset = process.argv.includes("--reset");
  const { data: existing } = await admin
    .from("forms")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    if (!reset) {
      console.log(
        `"${slug}" already exists: skipped (use --reset to recreate).`,
      );
      return null;
    }
    await admin.from("forms").delete().eq("id", existing.id);
  }
  const definition = briUmkmDefinition() as unknown as NonNullable<Json>;
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: ownerProfile.workspace_id,
      owner_id: ownerProfile.id,
      title,
      description: BRI_DESCRIPTION,
      slug,
      draft_definition: definition,
      thank_you_message: "Terima kasih atas waktu dan jawaban Bapak/Ibu.",
      closed_message: "Pengumpulan data survei ini sudah selesai.",
      capi_settings: briUmkmCapiSettings() as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data: version, error: vError } = await admin
    .from("form_versions")
    .insert({
      form_id: form.id,
      version_number: 1,
      definition,
      published_by: ownerProfile.id,
    })
    .select("id")
    .single();
  if (vError) throw vError;
  const { error: pError } = await admin
    .from("forms")
    .update({ current_version_id: version.id, status: "published" })
    .eq("id", form.id);
  if (pError) throw pError;
  return { id: form.id, versionId: version.id };
}

/** Backcheck failures QC rejects (archived); interviewed on top of n so n responses stay. */
const REJECTS = 4;

/** ~n interviews spread over the 20 cells, at most 20 per cell. */
function cellPlan(n: number, r: () => number) {
  const cells: { city: number; sector: 1 | 2; bri: boolean }[] = [];
  for (const city of CITIES)
    for (const sector of [1, 2] as const)
      for (const bri of [true, false])
        cells.push({ city: city.option, sector, bri });
  const counts = cells.map(() => 0);
  const plan: (typeof cells)[number][] = [];
  for (let i = 0; i < n; i++) {
    const open = cells.map((_, j) => j).filter((j) => counts[j] < 20);
    if (!open.length) break;
    // Fill cells unevenly (fieldwork in progress): favour cells with fewer interviews.
    const j = open.sort((a, b) => counts[a] - counts[b] + (r() - 0.5) * 6)[0];
    counts[j]++;
    plan.push(cells[j]);
  }
  return plan;
}

async function main() {
  const url = assertTarget();
  const n = Math.min(arg("n", 300), 400);
  const admin = createAdminClient();
  const ownerProfile = await owner(admin);

  const surveyors = new Map<string, string>();
  for (const city of CITIES)
    surveyors.set(
      city.code,
      await ensureUser(
        admin,
        `surveyor.${city.code.toLowerCase()}@formpulse.test`,
        `Surveyor ${city.name}`,
      ),
    );

  const original = await createForm(admin, SLUG, BRI_TITLE, ownerProfile);
  const sample = await createForm(
    admin,
    SAMPLE_SLUG,
    `${BRI_TITLE} (Contoh ${n} jawaban)`,
    ownerProfile,
  );

  for (const form of [original, sample]) {
    if (!form) continue;
    const { error } = await admin.from("form_members").upsert(
      [...surveyors.values()].map((user_id) => ({
        form_id: form.id,
        user_id,
        role: "surveyor" as const,
      })),
      { onConflict: "form_id,user_id" },
    );
    if (error) throw error;
  }

  const summary: Record<string, number> = {
    interviews: 0,
    screenouts: 0,
    flagged: 0,
  };
  if (sample) {
    const definition = briUmkmDefinition();
    const settings = briUmkmCapiSettings();
    const r = rng(20261021);
    const plan = cellPlan(n + REJECTS, r);
    const DAY = 24 * 3600 * 1000;
    const start = Date.now() - 14 * DAY;

    for (let i = 0; i < plan.length; i++) {
      const cell = plan[i];
      const profile = profileFor(r, cell);
      const interview = sampleInterview(r, definition, profile);
      // Working hours in WIB (UTC+7), across 14 days.
      const day = Math.floor((i / plan.length) * 14);
      const hour = 8 + Math.floor(r() * 11);
      const finishedAt =
        start +
        day * DAY +
        (hour - 7) * 3600 * 1000 +
        Math.floor(r() * 3600 * 1000);
      const photoId = randomUUID();
      const prepared = prepareAnswers(definition, interview.answers, {
        j4_foto: photoId,
      });
      if (!prepared.ok)
        throw new Error(`interview ${i}: ${JSON.stringify(prepared.errors)}`);
      const hasPhoto = prepared.rows.some(
        (row) => row.question_type === "photo",
      );
      const flags = qcFlags(
        settings,
        definition,
        prepared.answers,
        interview.duration,
      );
      if (flags.length) summary.flagged++;
      const { error } = await admin
        .rpc("submit_response", {
          p_form_id: sample.id,
          p_version_id: sample.versionId,
          p_submission_token: randomUUID(),
          p_answers: prepared.rows,
          p_duration_seconds: interview.duration,
          p_locale: "id",
          p_device: r() < 0.85 ? "mobile" : "tablet",
          p_surveyor_id: surveyors.get(profile.city.code),
          p_notes: interview.notes,
          p_quota_cell: quotaCell(settings, prepared.answers) ?? undefined,
          p_quota_target: settings.quota.target,
          p_quota_reserve: settings.quota.reserve,
          p_id_digits: settings.respondentId.digits,
          p_qc_flags: flags,
          p_photos: hasPhoto
            ? [
                {
                  id: photoId,
                  mime: "image/jpeg",
                  data: SAMPLE_PHOTO.split(",")[1],
                },
              ]
            : undefined,
          p_submitted_at: new Date(finishedAt).toISOString(),
        })
        .single();
      if (error) throw new Error(`submit ${i}: ${error.message}`);
      summary.interviews++;
    }

    // Screen-outs (about 15 % of contacts).
    const screenouts = Math.round(plan.length * 0.15);
    for (let i = 0; i < screenouts; i++) {
      const cell = plan[Math.floor(r() * plan.length)];
      const profile = profileFor(r, cell);
      const so = sampleScreenOut(r, profile);
      const finishedAt =
        start +
        Math.floor(r() * 14) * DAY +
        (1 + Math.floor(r() * 10)) * 3600 * 1000;
      const { error } = await admin.rpc("record_screenout", {
        p_form_id: sample.id,
        p_version_id: sample.versionId,
        p_submission_token: randomUUID(),
        p_kind: "rule",
        p_question_key: so.code.toLowerCase(),
        p_question_code: so.code,
        p_answers: so.answers as never,
        p_surveyor_id: surveyors.get(profile.city.code),
        p_duration_seconds: 60 + Math.floor(r() * 240),
        p_locale: "id",
        p_device: "mobile",
        p_submitted_at: new Date(finishedAt).toISOString(),
      });
      if (error) throw new Error(`screen-out ${i}: ${error.message}`);
      summary.screenouts++;
    }

    // QC: a 20 % backcheck sample, most confirmed, a few rejected.
    const { data: picked } = await admin.rpc("qc_select_backcheck", {
      p_form_id: sample.id,
      p_percent: settings.qc.backcheckPercent,
    });
    summary.backcheck = picked ?? 0;
    const { data: backcheck } = await admin
      .from("responses")
      .select("id, qc_flags")
      .eq("form_id", sample.id)
      .eq("qc_status", "backcheck");
    let rejected = 0;
    for (const [i, row] of (backcheck ?? []).entries()) {
      // Every 7th backcheck fails (deterministic, so exactly REJECTS are archived).
      if (i % 7 !== 3 || rejected >= REJECTS) {
        await admin.rpc("qc_set_status", {
          p_response_id: row.id,
          p_status: "approved",
          p_note: "Backcheck telepon: S1, S2, S5 dan I3a terkonfirmasi.",
        });
      } else {
        await admin.rpc("qc_reject", {
          p_response_id: row.id,
          p_reason: "Backcheck gagal: responden tidak ingat diwawancarai.",
        });
        rejected++;
      }
    }
    summary.rejected = rejected;
  }

  console.log(`\nBRI UMKM survey in ${url}`);
  console.table(
    [
      original && { form: SLUG, id: original.id, responses: 0 },
      sample && {
        form: SAMPLE_SLUG,
        id: sample.id,
        responses: summary.interviews - (summary.rejected ?? 0),
      },
    ].filter(Boolean),
  );
  if (sample) console.table([summary]);
  console.log("Surveyors (password Password123!):");
  console.table(
    CITIES.map((c) => ({
      email: `surveyor.${c.code.toLowerCase()}@formpulse.test`,
      city: c.name,
    })),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
