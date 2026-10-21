/**
 * CAPI interviews over HTTP (needs the app at APP_URL; HTTP suites are
 * skipped with a notice otherwise) plus the QC RPCs and surveyor access.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CapiSettings } from "@/lib/forms/capi";
import type { FormDefinition } from "@/lib/forms/schema";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  DUMMY_PASSWORD,
  adminClient,
  profileId,
  sessionCookieHeader,
  signedInClient,
} from "./helpers";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const admin = adminClient();
const created: string[] = [];
const SURVEYOR = `it-surveyor-${randomUUID().slice(0, 8)}@formpulse.test`;
let surveyorId: string;

async function appIsUp(): Promise<boolean> {
  try {
    return (
      (await fetch(`${APP_URL}/id/login`, { redirect: "manual" })).status < 500
    );
  } catch {
    return false;
  }
}
const up = await appIsUp();
if (!up)
  console.warn(
    `[capi.test] ${APP_URL} not reachable: skipping HTTP interview tests.`,
  );

// 1x1 transparent PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  sections: [
    {
      id: "s1",
      title: "Screening",
      questions: [
        {
          id: "q1",
          key: "city",
          code: "S1",
          type: "multiple_choice",
          title: "City",
          required: true,
          options: [
            { id: "jkt", label: "Jakarta", code: "1" },
            { id: "sby", label: "Surabaya", code: "2" },
          ],
        },
        {
          id: "q2",
          key: "owner",
          code: "S2",
          type: "multiple_choice",
          title: "Owner?",
          required: true,
          options: [
            { id: "yes", label: "Yes", code: "1" },
            { id: "no", label: "No", code: "2" },
          ],
          rules: [
            {
              when: {
                combinator: "and",
                conditions: [
                  { questionKey: "owner", operator: "equals", value: "no" },
                ],
              },
              action: "terminate",
              reason: "Not the owner",
            },
          ],
        },
      ],
    },
    {
      id: "s2",
      title: "Main",
      questions: [
        {
          id: "q3",
          key: "omzet",
          code: "A1",
          type: "short_text",
          title: "Turnover",
          required: true,
          noteRequired: true,
        },
        {
          id: "q4",
          key: "gps",
          code: "J1",
          type: "location",
          title: "GPS",
          required: false,
        },
        {
          id: "q5",
          key: "shop",
          code: "J2",
          type: "photo",
          title: "Shop photo",
          required: false,
        },
      ],
    },
  ],
};

const SETTINGS: CapiSettings = {
  enabled: true,
  notes: true,
  dimensions: [
    {
      id: "city",
      label: "City",
      questionKey: "city",
      groups: [
        { code: "JKT", label: "Jakarta", optionIds: ["jkt"] },
        { code: "SBY", label: "Surabaya", optionIds: ["sby"] },
      ],
    },
  ],
  quota: { enabled: true, target: 1, reserve: 1, checkAfter: "city" },
  respondentId: { enabled: true, digits: 2 },
  qc: {
    minMinutes: 12,
    maxMinutes: 45,
    backcheckPercent: 50,
    otherPercent: 15,
  },
};

async function createCapiForm() {
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: await profileId(DUMMY.editor),
      title: "CAPI fixture",
      slug: `it-capi-${randomUUID().slice(0, 8)}`,
      draft_definition: DEFINITION as unknown as NonNullable<Json>,
      capi_settings: SETTINGS as unknown as NonNullable<Json>,
    })
    .select("id, slug")
    .single();
  if (error) throw error;
  created.push(form.id);
  const { data: version, error: vError } = await admin
    .from("form_versions")
    .insert({
      form_id: form.id,
      version_number: 1,
      definition: DEFINITION as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (vError) throw vError;
  await admin
    .from("forms")
    .update({ current_version_id: version.id, status: "published" })
    .eq("id", form.id);
  const { error: mError } = await admin
    .from("form_members")
    .insert({ form_id: form.id, user_id: surveyorId, role: "surveyor" });
  if (mError) throw mError;
  return { formId: form.id, slug: form.slug, versionId: version.id };
}

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: SURVEYOR,
    password: DUMMY_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "IT Surveyor" },
  });
  if (error || !data.user) throw error ?? new Error("createUser");
  surveyorId = data.user.id;
  await admin
    .from("profiles")
    .update({ role: "surveyor" })
    .eq("id", surveyorId);
});

afterAll(async () => {
  for (const id of created) await admin.from("forms").delete().eq("id", id);
  if (surveyorId) await admin.auth.admin.deleteUser(surveyorId);
});

const complete = {
  city: { selected: ["jkt"] },
  owner: { selected: ["yes"] },
  omzet: "10 juta",
  gps: { lat: -6.2, lng: 106.8, accuracy: 12 },
  shop: { photo: PNG },
};

function payload(versionId: string, extra: Record<string, unknown> = {}) {
  const finishedAt = Date.now();
  return {
    versionId,
    answers: complete,
    notes: { omzet: "Responden menyebut kisaran" },
    submissionToken: randomUUID(),
    startedAt: finishedAt - 20 * 60_000,
    finishedAt,
    locale: "id",
    ...extra,
  };
}

async function post(formId: string, body: unknown, cookie?: string) {
  const res = await fetch(`${APP_URL}/api/interviews/${formId}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      "user-agent": "Mozilla/5.0 (Linux; Android 14) Mobile",
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("surveyor access", () => {
  it("can interview but not view dashboards or responses", async () => {
    const { formId } = await createCapiForm();
    const { client } = await signedInClient(SURVEYOR);
    expect(
      (await client.rpc("can_interview", { p_form_id: formId })).data,
    ).toBe(true);
    expect(
      (await client.rpc("can_view_form", { p_form_id: formId })).data,
    ).toBe(false);
    const { data: forms } = await client.rpc("list_interview_forms");
    expect((forms ?? []).map((f) => f.id)).toContain(formId);
    const { data: rows } = await client
      .from("responses")
      .select("id")
      .eq("form_id", formId);
    expect(rows ?? []).toHaveLength(0);
    const { error } = await client.rpc("qc_overview", { p_form_id: formId });
    expect(error).not.toBeNull();
  });
});

describe.skipIf(!up)("POST /api/interviews/[id]/submit", () => {
  let cookie: string;
  beforeAll(async () => {
    cookie = await sessionCookieHeader(SURVEYOR);
  });

  it("rejects requests without a session", async () => {
    const { formId, versionId } = await createCapiForm();
    const res = await post(formId, payload(versionId));
    expect(res.status).toBe(401);
  });

  it("stores a complete interview with respondent code, notes, GPS and photo", async () => {
    const { formId, versionId } = await createCapiForm();
    const res = await post(formId, payload(versionId), cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: "complete",
      respondentCode: "JKT-01",
    });
    const { data: row } = await admin
      .from("responses")
      .select("surveyor_id, quota_cell, notes, qc_status, qc_flags, device")
      .eq("id", res.body.responseId as string)
      .single();
    expect(row).toMatchObject({
      surveyor_id: surveyorId,
      quota_cell: "JKT",
      qc_status: "pending",
      notes: { omzet: "Responden menyebut kisaran" },
    });
    const { data: answers } = await admin
      .from("response_answers")
      .select("question_key, value_json")
      .eq("response_id", res.body.responseId as string)
      .in("question_key", ["gps", "shop"]);
    const byKey = Object.fromEntries(
      (answers ?? []).map((a) => [a.question_key, a.value_json]),
    );
    expect(byKey.gps).toMatchObject({ lat: -6.2, lng: 106.8 });
    const photoId = (byKey.shop as { photoId?: string } | null)?.photoId;
    expect(photoId).toBeTruthy();

    // The photo is served to people who may view the form, not to anon.
    const anonPhoto = await fetch(`${APP_URL}/api/photos/${photoId}`);
    expect(anonPhoto.status).not.toBe(200);
    const editorPhoto = await fetch(`${APP_URL}/api/photos/${photoId}`, {
      headers: { cookie: await sessionCookieHeader(DUMMY.editor) },
    });
    expect(editorPhoto.status).toBe(200);
    expect(editorPhoto.headers.get("content-type")).toBe("image/png");
  });

  it("requires surveyor notes on marked questions", async () => {
    const { formId, versionId } = await createCapiForm();
    const res = await post(formId, payload(versionId, { notes: {} }), cookie);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "NOTES_REQUIRED",
      notes: ["omzet"],
    });
  });

  it("records a screen-out rule instead of a response", async () => {
    const { formId, versionId } = await createCapiForm();
    const res = await post(
      formId,
      payload(versionId, {
        answers: { city: { selected: ["sby"] }, owner: { selected: ["no"] } },
        notes: {},
      }),
      cookie,
    );
    expect(res.body).toMatchObject({
      ok: true,
      status: "screened_out",
      kind: "rule",
      code: "S2",
    });
    const { data: so } = await admin
      .from("response_screenouts")
      .select("kind, question_code, reason, quota_cell")
      .eq("form_id", formId);
    expect(so).toEqual([
      {
        kind: "rule",
        question_code: "S2",
        reason: "Not the owner",
        quota_cell: "SBY",
      },
    ]);
  });

  it("numbers respondents per cell and screens out when the cell is full", async () => {
    const { formId, versionId } = await createCapiForm();
    const first = await post(formId, payload(versionId), cookie);
    const second = await post(formId, payload(versionId), cookie);
    expect(first.body.respondentCode).toBe("JKT-01");
    expect(second.body.respondentCode).toBe("JKT-02"); // the reserve
    const third = await post(formId, payload(versionId), cookie);
    expect(third.body).toMatchObject({ status: "screened_out", kind: "quota" });
    expect(
      (await admin.rpc("quota_count", { p_form_id: formId, p_cell: "JKT" }))
        .data,
    ).toBe(2);
    // A live "quota full" screen-out is refused while the cell has room.
    const sby = await post(
      formId,
      payload(versionId, {
        answers: { ...complete, city: { selected: ["sby"] } },
        screenOut: "quota",
      }),
      cookie,
    );
    expect(sby.body).toMatchObject({ ok: false, code: "QUOTA_AVAILABLE" });
  });

  it("flags short interviews and replays a resent submission", async () => {
    const { formId, versionId } = await createCapiForm();
    const body = payload(versionId, { startedAt: Date.now() - 3 * 60_000 });
    const res = await post(formId, body, cookie);
    const again = await post(formId, body, cookie);
    expect(again.body).toMatchObject({
      responseId: res.body.responseId,
      replayed: true,
    });
    const { data } = await admin
      .from("responses")
      .select("qc_flags")
      .eq("id", res.body.responseId as string)
      .single();
    expect(data?.qc_flags).toContain("duration_short");
  });

  it("refuses public submissions to interview-only forms", async () => {
    const { slug, versionId } = await createCapiForm();
    const res = await fetch(`${APP_URL}/api/f/${slug}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        versionId,
        answers: complete,
        submissionToken: randomUUID(),
        startedAt: Date.now() - 60_000,
        locale: "id",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!up)("quality control", () => {
  it("selects a backcheck sample, approves, rejects and restores", async () => {
    const { formId, versionId } = await createCapiForm();
    const cookie = await sessionCookieHeader(SURVEYOR);
    for (const city of ["jkt", "sby"])
      await post(
        formId,
        payload(versionId, {
          answers: { ...complete, city: { selected: [city] } },
        }),
        cookie,
      );

    const { client: viewer } = await signedInClient(DUMMY.viewer);
    expect(
      (await viewer.rpc("qc_select_backcheck", { p_form_id: formId })).error,
    ).not.toBeNull();

    const { client: editor } = await signedInClient(DUMMY.editor);
    const picked = await editor.rpc("qc_select_backcheck", {
      p_form_id: formId,
      p_percent: 50,
    });
    expect(picked.error).toBeNull();
    expect(picked.data).toBe(1);

    const { data: rows } = await admin
      .from("responses")
      .select("id, qc_status, backcheck_at")
      .eq("form_id", formId)
      .order("respondent_code");
    expect(rows?.filter((r) => r.qc_status === "backcheck")).toHaveLength(1);

    const [a, b] = rows!;
    expect(
      (
        await editor.rpc("qc_set_status", {
          p_response_id: a.id,
          p_status: "approved",
          p_note: "ok",
        })
      ).error,
    ).toBeNull();
    expect(
      (await editor.rpc("qc_reject", { p_response_id: b.id, p_reason: "fake" }))
        .error,
    ).toBeNull();

    const { data: left } = await admin
      .from("responses")
      .select("id, qc_status")
      .eq("form_id", formId);
    expect(left).toEqual([{ id: a.id, qc_status: "approved" }]);

    const { data: archived } = await admin
      .from("response_archive")
      .select("id, reason")
      .eq("form_id", formId)
      .single();
    expect(archived?.reason).toBe("fake");
    // The rejected interview frees its quota cell.
    expect(
      (await admin.rpc("quota_count", { p_form_id: formId, p_cell: "SBY" }))
        .data,
    ).toBe(0);

    expect(
      (await editor.rpc("qc_restore", { p_archive_id: archived!.id })).error,
    ).toBeNull();
    const { count } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId);
    expect(count).toBe(2);

    const { data: overview } = await editor.rpc("qc_overview", {
      p_form_id: formId,
    });
    expect(overview).toBeTruthy();
  });
});
