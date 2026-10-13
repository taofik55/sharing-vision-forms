/**
 * Phase 5 database behaviour: dashboard summaries (summary path == raw path,
 * exact after inserts / deletes), export keyset pages and masking, share-link
 * RLS, demo-form filtering and demo function privileges.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DashboardBundle } from "@/lib/analytics/types";
import { ensureDemoForm, generateDemo } from "@/lib/demo/server";
import {
  DUMMY,
  adminClient,
  anonClient,
  profileId,
  signedInClient,
} from "./helpers";

const admin = adminClient();
let formId: string;
let editor: Awaited<ReturnType<typeof signedInClient>>;
let viewer: Awaited<ReturnType<typeof signedInClient>>;
let emailKey: string;
let paragraphKey: string;

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
const jakartaMidnight = (offsetDays: number) =>
  Math.floor((Date.now() + WIB) / DAY) * DAY - WIB + offsetDays * DAY;
const iso = (ms: number) => new Date(ms).toISOString();

async function bundle(
  filters: Record<string, unknown>,
): Promise<DashboardBundle> {
  const { data, error } = await editor.client.rpc("dashboard_bundle", {
    p_form_id: formId,
    p_filters: filters as never,
  });
  if (error) throw error;
  return data as unknown as DashboardBundle;
}

async function summaryRows() {
  const [a, r] = await Promise.all([
    admin
      .from("answer_summary")
      .select("*")
      .eq("form_id", formId)
      .order("day")
      .order("question_key")
      .order("form_version_id")
      .order("device")
      .order("locale")
      .order("kind")
      .order("value"),
    admin
      .from("response_summary")
      .select("*")
      .eq("form_id", formId)
      .order("hour")
      .order("form_version_id")
      .order("device")
      .order("locale"),
  ]);
  if (a.error) throw a.error;
  if (r.error) throw r.error;
  return { answers: a.data, responses: r.data };
}

beforeAll(async () => {
  const ownerId = await profileId(DUMMY.editor);
  const form = await ensureDemoForm(admin, {
    slug: `it-scale-${randomUUID().slice(0, 8)}`,
    title: "Integration scale (Demo)",
    ownerId,
  });
  formId = form.id;
  await admin.from("form_members").insert({
    form_id: formId,
    user_id: await profileId(DUMMY.viewer),
    role: "viewer",
  });
  await generateDemo(admin, formId, 600, 60);
  editor = await signedInClient(DUMMY.editor);
  viewer = await signedInClient(DUMMY.viewer);

  const { data: f } = await admin
    .from("forms")
    .select("current_version_id")
    .eq("id", formId)
    .single();
  const { data: v } = await admin
    .from("form_versions")
    .select("definition")
    .eq("id", f!.current_version_id!)
    .single();
  const questions = (
    v!.definition as unknown as {
      sections: { questions: { key: string; type: string }[] }[];
    }
  ).sections.flatMap((s) => s.questions);
  emailKey = questions.find((q) => q.type === "email")!.key;
  paragraphKey = questions.find((q) => q.type === "paragraph")!.key;
}, 120_000);

afterAll(async () => {
  if (formId) await admin.from("forms").delete().eq("id", formId);
});

describe("dashboard summaries", () => {
  it("returns the same statistics as the raw path (no filters)", async () => {
    // A date range that is not on an hour / day boundary forces the raw path
    // while still covering every response.
    const [summary, raw] = await Promise.all([
      bundle({}),
      bundle({ from: "2000-01-01T00:00:00.001+07:00" }),
    ]);
    expect(summary.overview.total).toBe(600);
    expect(summary.questions).toEqual(raw.questions);
    for (const key of [
      "total",
      "today",
      "last7",
      "prev7",
      "first_at",
      "last_at",
      "heatmap",
      "duration",
      "devices",
      "locales",
      "versions",
      "funnel",
    ] as const) {
      expect(summary.overview[key], key).toEqual(raw.overview[key]);
    }
  });

  it("returns the same bundle as the raw path for a 30-day window with device and language", async () => {
    const from = jakartaMidnight(-29);
    const to = jakartaMidnight(1);
    const filters = { to: iso(to), device: "mobile", locale: "id" };
    const [summary, raw] = await Promise.all([
      bundle({ ...filters, from: iso(from) }),
      bundle({ ...filters, from: iso(from + 1) }),
    ]);
    expect(summary.overview.total).toBeGreaterThan(0);
    expect(summary.questions).toEqual(raw.questions);
    expect({ ...summary.overview }).toEqual({ ...raw.overview });
  });

  it("stays exact after live inserts and deletes (equals a full rebuild)", async () => {
    const { error } = await admin.rpc("generate_demo_responses", {
      p_form_id: formId,
      p_n: 25,
      p_days: 1,
      p_live: true,
    });
    expect(error).toBeNull();
    const { data: some } = await admin
      .from("responses")
      .select("id")
      .eq("form_id", formId)
      .order("id")
      .limit(40);
    await admin
      .from("responses")
      .delete()
      .in(
        "id",
        some!.map((r) => r.id),
      );

    const incremental = await summaryRows();
    const { error: rebuildError } = await admin.rpc(
      "rebuild_dashboard_summary",
      {
        p_form_id: formId,
      },
    );
    expect(rebuildError).toBeNull();
    const rebuilt = await summaryRows();
    expect(incremental.answers.length).toBeGreaterThan(100);
    expect(incremental).toEqual(rebuilt);
    expect((await bundle({})).overview.total).toBe(585);
  });

  it("is not readable by signed-in users", async () => {
    const { error } = await editor.client
      .from("answer_summary")
      .select("form_id")
      .limit(1);
    expect(error?.code).toBe("42501");
    const { error: e2 } = await editor.client
      .from("response_summary")
      .select("form_id")
      .limit(1);
    expect(e2?.code).toBe("42501");
  });
});

describe("export_responses", () => {
  beforeAll(async () => {
    // One response with identifiers (the generator leaves them empty).
    const { data: f } = await admin
      .from("forms")
      .select("current_version_id")
      .eq("id", formId)
      .single();
    const { data: r, error } = await admin
      .from("responses")
      .insert({
        form_id: formId,
        form_version_id: f!.current_version_id!,
        identifier_email: "ida@example.com",
        identifier_key: "ida@example.com",
        is_demo: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    await admin.from("response_answers").insert({
      response_id: r.id,
      form_id: formId,
      question_key: emailKey,
      question_type: "email",
      value_text: "ida@example.com",
    });
  });

  type Row = {
    id: string;
    submitted_at: string;
    identifier_email: string | null;
    answers: Record<string, { t?: string }>;
  };
  async function exportAll(client: typeof editor.client) {
    const rows: Row[] = [];
    let cursor: { at: string; id: string } | null = null;
    for (;;) {
      const { data, error } = await client.rpc("export_responses", {
        p_form_id: formId,
        p_filters: {},
        p_after_at: cursor?.at,
        p_after_id: cursor?.id,
        p_limit: 250,
      });
      if (error) throw error;
      const page = data as unknown as Row[];
      rows.push(...page);
      if (page.length < 250) return rows;
      cursor = { at: page.at(-1)!.submitted_at, id: page.at(-1)!.id };
    }
  }

  it("pages through every response once, oldest first", async () => {
    const rows = await exportAll(editor.client);
    expect(rows).toHaveLength(586);
    expect(new Set(rows.map((r) => r.id)).size).toBe(586);
    const times = rows.map((r) => Date.parse(r.submitted_at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("includes identifiers and email answers only for editors", async () => {
    const editorRows = await exportAll(editor.client);
    const own = editorRows.find(
      (r) => r.identifier_email === "ida@example.com",
    );
    expect(own?.answers[emailKey]?.t).toBe("ida@example.com");

    const viewerRows = await exportAll(viewer.client);
    expect(viewerRows).toHaveLength(586);
    expect(viewerRows.every((r) => r.identifier_email === null)).toBe(true);
    const masked = viewerRows.find((r) => r.id === own!.id)!;
    expect(masked.answers[emailKey]?.t).toBe("i***@example.com");
    expect(
      viewerRows.some(
        (r) =>
          r.answers[emailKey]?.t && !r.answers[emailKey].t!.includes("***"),
      ),
    ).toBe(false);
  });

  it("is denied to users without access", async () => {
    const { error } = await anonClient().rpc("export_responses", {
      p_form_id: formId,
    });
    expect(error).not.toBeNull();
  });
});

describe("answer privacy for viewers", () => {
  it("cannot read response_answers directly", async () => {
    const { error } = await viewer.client
      .from("response_answers")
      .select("id")
      .limit(1);
    expect(error?.code).toBe("42501");
  });

  it("gets email answers masked in list_responses and cannot search them", async () => {
    const { data } = await viewer.client.rpc("list_responses", {
      p_form_id: formId,
      p_search: "ida@example",
    });
    expect((data as unknown as { total: number }).total).toBe(0);
    const { data: page } = await viewer.client.rpc("list_responses", {
      p_form_id: formId,
    });
    const rows = (
      page as unknown as { rows: { answers: Record<string, { t?: string }> }[] }
    ).rows;
    const emails = rows.map((r) => r.answers[emailKey]?.t).filter(Boolean);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => e!.includes("***"))).toBe(true);
  });

  it("question_text_answers only returns free-text questions", async () => {
    const { data: emails } = await editor.client.rpc("question_text_answers", {
      p_form_id: formId,
      p_question_key: emailKey,
    });
    expect(emails).toEqual([]);
    const { data: texts } = await editor.client.rpc("question_text_answers", {
      p_form_id: formId,
      p_question_key: paragraphKey,
    });
    expect((texts ?? []).length).toBeGreaterThan(0);
  });
});

describe("dashboard_shares RLS", () => {
  it("lets the owner create a link and hides links from viewers and anon", async () => {
    const token = `it-${randomUUID().replace(/-/g, "")}`;
    const { error } = await editor.client
      .from("dashboard_shares")
      .insert({ form_id: formId, token, created_by: editor.userId });
    expect(error).toBeNull();

    const { data: seen } = await viewer.client
      .from("dashboard_shares")
      .select("id")
      .eq("form_id", formId);
    expect(seen).toEqual([]);
    const { error: insertError } = await viewer.client
      .from("dashboard_shares")
      .insert({
        form_id: formId,
        token: `${token}x`,
        created_by: viewer.userId,
      });
    expect(insertError).not.toBeNull();
    const { data: anonSeen } = await anonClient()
      .from("dashboard_shares")
      .select("id");
    expect(anonSeen ?? []).toEqual([]);
  });
});

describe("demo forms and demo functions", () => {
  it("are hidden from list_forms unless requested", async () => {
    const { data: hidden } = await editor.client.rpc("list_forms", {
      p_limit: 100,
      p_search: "Integration scale",
    });
    expect((hidden ?? []).some((f) => f.id === formId)).toBe(false);
    const { data: shown } = await editor.client.rpc("list_forms", {
      p_limit: 100,
      p_search: "Integration scale",
      p_include_demo: true,
    });
    const row = (shown ?? []).find((f) => f.id === formId);
    expect(row?.is_demo).toBe(true);
    expect(Number(row?.response_count)).toBe(586);
  });

  it("generator, cleanup and rebuild are secret-key only", async () => {
    const calls = [
      editor.client.rpc("generate_demo_responses", {
        p_form_id: formId,
        p_n: 1,
      }),
      editor.client.rpc("delete_demo_responses", { p_form_id: formId }),
      editor.client.rpc("rebuild_dashboard_summary", { p_form_id: formId }),
      editor.client.rpc("analyze_response_tables"),
    ];
    for (const { error } of await Promise.all(calls)) {
      expect(error?.code).toBe("42501");
    }
  });

  it("deletes demo rows in chunks, oldest first", async () => {
    const { data: first } = await admin.rpc("delete_demo_responses", {
      p_form_id: formId,
      p_limit: 500,
    });
    expect(first).toBe(500);
    const { data: rest } = await admin.rpc("delete_demo_responses", {
      p_form_id: formId,
      p_limit: 500,
    });
    expect(rest).toBe(86);
    expect((await bundle({})).overview.total).toBe(0);
    const { answers, responses } = await summaryRows();
    expect(answers).toEqual([]);
    expect(responses).toEqual([]);
  });
});
