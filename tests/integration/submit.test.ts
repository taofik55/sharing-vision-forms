/**
 * Phase 3 submission pipeline, end to end over HTTP (needs the app at APP_URL,
 * e.g. `pnpm dev`; HTTP suites are skipped with a notice otherwise) plus
 * direct database checks with the admin client.
 */
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { OTHER_OPTION_ID, type FormDefinition } from "@/lib/forms/schema";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  adminClient,
  anonClient,
  profileId,
} from "./helpers";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const admin = adminClient();
const created: string[] = [];

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
    `[submit.test] ${APP_URL} not reachable: skipping HTTP submission tests.`,
  );

const yesNo = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  sections: [
    {
      id: "s1",
      title: "One",
      questions: [
        {
          id: "q1",
          key: "name",
          type: "short_text",
          title: "Name",
          required: true,
        },
        {
          id: "q2",
          key: "age",
          type: "number",
          title: "Age",
          required: false,
          validation: { min: 0, max: 120 },
        },
        { id: "q3", key: "day", type: "date", title: "Day", required: false },
        {
          id: "q4",
          key: "color",
          type: "multiple_choice",
          title: "Color",
          required: false,
          options: yesNo,
          allowOther: true,
        },
      ],
    },
    {
      id: "s2",
      title: "Two",
      questions: [
        {
          id: "q5",
          key: "tags",
          type: "checkboxes",
          title: "Tags",
          required: false,
          options: yesNo,
        },
        {
          id: "q6",
          key: "pick",
          type: "dropdown",
          title: "Pick",
          required: false,
          options: yesNo,
        },
        {
          id: "q7",
          key: "stars",
          type: "rating",
          title: "Stars",
          required: false,
          rating: { max: 5 },
        },
        {
          id: "q8",
          key: "scale",
          type: "linear_scale",
          title: "Scale",
          required: false,
          scale: { min: 0, max: 10 },
        },
        {
          id: "q9",
          key: "contact",
          type: "multiple_choice",
          title: "Contact?",
          required: false,
          options: yesNo,
        },
        {
          id: "q10",
          key: "why",
          type: "paragraph",
          title: "Why",
          required: true,
          showIf: {
            combinator: "and",
            conditions: [
              { questionKey: "contact", operator: "equals", value: "yes" },
            ],
          },
        },
      ],
    },
  ],
};

type FormOptions = {
  identifierMode?: "none" | "email" | "phone" | "email_or_phone";
  status?: "published" | "closed";
  deadlineAt?: string | null;
  draftDefinition?: FormDefinition;
};

async function createPublishedForm(options: FormOptions = {}) {
  const slug = `it-submit-${randomUUID().slice(0, 8)}`;
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: await profileId(DUMMY.editor),
      title: "Submit fixture",
      slug,
      identifier_mode: options.identifierMode ?? "none",
      deadline_at: options.deadlineAt ?? null,
      draft_definition: (options.draftDefinition ??
        DEFINITION) as unknown as NonNullable<Json>,
    })
    .select("id")
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
    .update({
      current_version_id: version.id,
      status: options.status ?? "published",
    })
    .eq("id", form.id);
  return { formId: form.id, slug, versionId: version.id };
}

afterAll(async () => {
  for (const id of created) await admin.from("forms").delete().eq("id", id);
});

const fakeIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;

function payload(versionId: string, extra: Record<string, unknown> = {}) {
  return {
    versionId,
    answers: { name: "Ani" },
    submissionToken: randomUUID(),
    startedAt: Date.now() - 10_000,
    locale: "en",
    ...extra,
  };
}

async function post(slug: string, body: unknown, ip = fakeIp()) {
  const res = await fetch(`${APP_URL}/api/f/${slug}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
      "user-agent": "Mozilla/5.0 (iPhone) Mobile",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function responsesFor(formId: string) {
  const { data } = await admin
    .from("responses")
    .select(
      "id, form_version_id, identifier_email, identifier_phone, identifier_key, duration_seconds, device, locale",
    )
    .eq("form_id", formId);
  return data ?? [];
}

describe("anon has no direct access (respondents go through Route Handlers)", () => {
  it.each([
    "check_rate_limit",
    "submit_response",
    "save_response_draft",
    "delete_response_draft",
  ] as const)("anon cannot execute %s", async (fn) => {
    const { error } = await anonClient().rpc(fn as never, {} as never);
    expect(error).not.toBeNull();
  });

  it("anon cannot insert into responses", async () => {
    const { error } = await anonClient()
      .from("responses")
      .insert({ form_id: randomUUID(), form_version_id: randomUUID() });
    expect(error?.code).toBe("42501");
  });
});

describe.skipIf(!up)("POST /api/f/[slug]/submit", () => {
  it("happy path: typed columns, hidden answers dropped, metadata stored", async () => {
    const { formId, slug, versionId } = await createPublishedForm();
    const { status, body } = await post(
      slug,
      payload(versionId, {
        answers: {
          name: "  Ani  ",
          age: 31,
          day: "2026-03-01",
          color: { selected: [OTHER_OPTION_ID], otherText: "teal" },
          tags: { selected: ["yes", "no"] },
          pick: { selected: ["no"] },
          stars: 4,
          scale: 0,
          contact: { selected: ["no"] },
          why: "hidden: must be dropped",
          bogus: "unknown key",
        },
      }),
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const [response] = await responsesFor(formId);
    expect(response).toMatchObject({
      id: body.responseId,
      form_version_id: versionId,
      device: "mobile",
      locale: "en",
    });
    expect(response.duration_seconds).toBeGreaterThanOrEqual(9);

    const { data: answers } = await admin
      .from("response_answers")
      .select(
        "question_key, question_type, value_text, value_number, value_date, value_options",
      )
      .eq("response_id", response.id);
    const byKey = Object.fromEntries(
      (answers ?? []).map((a) => [a.question_key, a]),
    );
    expect(Object.keys(byKey).sort()).toEqual([
      "age",
      "color",
      "contact",
      "day",
      "name",
      "pick",
      "scale",
      "stars",
      "tags",
    ]);
    expect(byKey.name).toMatchObject({ value_text: "Ani", value_number: null });
    expect(byKey.age).toMatchObject({ value_number: 31, value_text: null });
    expect(new Date(byKey.day.value_date!).toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(byKey.color).toMatchObject({
      value_options: [OTHER_OPTION_ID],
      value_text: "teal",
    });
    expect(byKey.tags.value_options).toEqual(["yes", "no"]);
    expect(byKey.pick.value_options).toEqual(["no"]);
    expect(byKey.stars.value_number).toBe(4);
    expect(byKey.scale.value_number).toBe(0);
  });

  it("is idempotent for the same submission token", async () => {
    const { formId, slug, versionId } = await createPublishedForm();
    const body = payload(versionId);
    const first = await post(slug, body);
    const second = await post(slug, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      ok: true,
      responseId: first.body.responseId,
      replayed: true,
    });
    expect(await responsesFor(formId)).toHaveLength(1);
  });

  it("rejects a duplicate email (normalized) with ALREADY_SUBMITTED", async () => {
    const { formId, slug, versionId } = await createPublishedForm({
      identifierMode: "email",
    });
    const first = await post(
      slug,
      payload(versionId, { identifier: { email: "Dup@Example.com" } }),
    );
    expect(first.status).toBe(200);
    const second = await post(
      slug,
      payload(versionId, { identifier: { email: "  dup@example.COM " } }),
    );
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ ok: false, code: "ALREADY_SUBMITTED" });
    expect(String(second.body.message)).toContain("already submitted");
    const rows = await responsesFor(formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      identifier_email: "dup@example.com",
      identifier_key: "dup@example.com",
    });
  });

  it("rejects a duplicate phone, also when an email is added (email_or_phone)", async () => {
    const { formId, slug, versionId } = await createPublishedForm({
      identifierMode: "email_or_phone",
    });
    expect(
      (
        await post(
          slug,
          payload(versionId, { identifier: { phone: "0812-5555-6666" } }),
        )
      ).status,
    ).toBe(200);
    const again = await post(
      slug,
      payload(versionId, {
        identifier: { email: "new@x.co", phone: "+62 812 5555 6666" },
      }),
    );
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_SUBMITTED");
    expect(
      (
        await post(
          slug,
          payload(versionId, { identifier: { email: "other@x.co" } }),
        )
      ).status,
    ).toBe(200);
    const rows = await responsesFor(formId);
    expect(rows.map((r) => r.identifier_key).sort()).toEqual([
      "6281255556666",
      "other@x.co",
    ]);
  });

  it("requires a valid identifier when the form needs one", async () => {
    const { slug, versionId } = await createPublishedForm({
      identifierMode: "phone",
    });
    const res = await post(
      slug,
      payload(versionId, { identifier: { phone: "123" } }),
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "IDENTIFIER_INVALID",
      identifierErrors: { phone: "invalidPhone" },
    });
  });

  it("rejects submissions after the deadline", async () => {
    const { formId, slug, versionId } = await createPublishedForm({
      deadlineAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await post(slug, payload(versionId));
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("FORM_CLOSED");
    expect(await responsesFor(formId)).toHaveLength(0);
    const page = await (await fetch(`${APP_URL}/en/f/${slug}`)).text();
    expect(page).toContain('data-testid="form-closed"');
  });

  it("rejects submissions to a closed form", async () => {
    const { slug, versionId } = await createPublishedForm({ status: "closed" });
    const res = await post(slug, payload(versionId));
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("FORM_CLOSED");
  });

  it("returns 404 for unknown slugs", async () => {
    const res = await post(
      `nope-${randomUUID().slice(0, 8)}`,
      payload(randomUUID()),
    );
    expect(res.status).toBe(404);
    expect(
      (await fetch(`${APP_URL}/en/f/nope-${randomUUID().slice(0, 8)}`)).status,
    ).toBe(404);
  });

  it("trips the per-form rate limit after 10 attempts", async () => {
    const { slug } = await createPublishedForm();
    const ip = fakeIp();
    for (let i = 0; i < 10; i++)
      expect((await post(slug, "{}", ip)).status).toBe(400);
    const limited = await post(slug, "{}", ip);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    // Another IP is unaffected.
    expect((await post(slug, "{}")).status).toBe(400);
  });

  it("fakes success for honeypot submissions and stores nothing", async () => {
    const { formId, slug, versionId } = await createPublishedForm();
    const res = await post(
      slug,
      payload(versionId, { honeypot: "https://spam.example" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await responsesFor(formId)).toHaveLength(0);
  });

  it("rejects submissions faster than 3 seconds", async () => {
    const { formId, slug, versionId } = await createPublishedForm();
    const res = await post(
      slug,
      payload(versionId, { startedAt: Date.now() - 500 }),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TOO_FAST");
    expect(await responsesFor(formId)).toHaveLength(0);
  });

  it("rejects payloads over 100 KB", async () => {
    const { slug, versionId } = await createPublishedForm();
    const res = await post(
      slug,
      payload(versionId, { answers: { name: "x".repeat(110 * 1024) } }),
    );
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns field errors for invalid answers", async () => {
    const { slug, versionId } = await createPublishedForm();
    const res = await post(
      slug,
      payload(versionId, {
        answers: {
          age: 500,
          contact: { selected: ["yes"] },
          name: "x".repeat(600),
        },
      }),
    );
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "VALIDATION_ERROR",
      errors: { name: "tooLong", age: "tooLarge", why: "required" },
    });
  });

  it("validates against the submitted version after a republish, and rejects foreign versions", async () => {
    const { formId, slug, versionId: v1 } = await createPublishedForm();
    // v2 drops the "name" question; v1 respondents can still submit with it.
    const v2Definition = structuredClone(DEFINITION);
    v2Definition.sections[0].questions.shift();
    const { data: v2 } = await admin
      .from("form_versions")
      .insert({
        form_id: formId,
        version_number: 2,
        definition: v2Definition as unknown as NonNullable<Json>,
      })
      .select("id")
      .single();
    await admin
      .from("forms")
      .update({ current_version_id: v2!.id })
      .eq("id", formId);

    const res = await post(
      slug,
      payload(v1, { answers: { name: "Started on v1" } }),
    );
    expect(res.status).toBe(200);
    expect((await responsesFor(formId))[0].form_version_id).toBe(v1);

    const other = await createPublishedForm();
    const foreign = await post(slug, payload(other.versionId));
    expect(foreign.status).toBe(409);
    expect(foreign.body.code).toBe("INVALID_VERSION");
  });

  it("never exposes the draft definition on the public page", async () => {
    const secret = structuredClone(DEFINITION);
    secret.sections[0].questions[0].title = "SECRET-DRAFT-MARKER";
    const { slug } = await createPublishedForm({ draftDefinition: secret });
    const html = await (await fetch(`${APP_URL}/en/f/${slug}`)).text();
    expect(html).toContain("Submit fixture");
    expect(html).not.toContain("SECRET-DRAFT-MARKER");
    expect(html).not.toContain(DUMMY.editor);
    expect(html).toContain('name="robots" content="noindex');
  });
});

describe.skipIf(!up)("/api/f/[slug]/draft", () => {
  async function draft(
    slug: string,
    method: string,
    body?: unknown,
    token?: string,
  ) {
    const url = `${APP_URL}/api/f/${slug}/draft${token ? `?token=${token}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-real-ip": fakeIp() },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      body: (await res.json()) as Record<string, unknown>,
    };
  }

  it("saves, reads, scopes to its form and is deleted by a successful submit", async () => {
    const { formId, slug, versionId } = await createPublishedForm();
    const token = randomUUID();
    const data = {
      answers: { name: "Draft" },
      sectionId: "s2",
      startedAt: Date.now() - 60_000,
    };
    expect(
      (await draft(slug, "PUT", { draftToken: token, versionId, data })).status,
    ).toBe(200);
    expect(
      (
        await draft(slug, "PUT", {
          draftToken: token,
          versionId,
          data: { ...data, sectionId: "s1" },
        })
      ).status,
    ).toBe(200);

    const read = await draft(slug, "GET", undefined, token);
    expect(read.body).toMatchObject({
      ok: true,
      versionId,
      data: { sectionId: "s1", answers: { name: "Draft" } },
    });
    const { data: row } = await admin
      .from("response_drafts")
      .select("expires_at")
      .eq("draft_token", token)
      .single();
    expect(new Date(row!.expires_at).getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600 * 1000,
    );

    // The same token cannot be read or hijacked through another form.
    const other = await createPublishedForm();
    expect((await draft(other.slug, "GET", undefined, token)).status).toBe(404);
    await draft(other.slug, "PUT", {
      draftToken: token,
      versionId: other.versionId,
      data,
    });
    const { data: still } = await admin
      .from("response_drafts")
      .select("form_id")
      .eq("draft_token", token)
      .single();
    expect(still!.form_id).toBe(formId);

    expect(
      (await post(slug, payload(versionId, { draftToken: token }))).status,
    ).toBe(200);
    const { count } = await admin
      .from("response_drafts")
      .select("id", { count: "exact", head: true })
      .eq("draft_token", token);
    expect(count).toBe(0);
  });

  it("rejects drafts for a version of another form", async () => {
    const { slug } = await createPublishedForm();
    const other = await createPublishedForm();
    const res = await draft(slug, "PUT", {
      draftToken: randomUUID(),
      versionId: other.versionId,
      data: { answers: {} },
    });
    expect(res.status).toBe(409);
  });
});
