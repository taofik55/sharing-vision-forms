/**
 * Phase 4 analytics RPCs against a 6-response fixture with hand-computed
 * expected values (see comments). Runs against .env.local (local stack).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FormDefinition } from "@/lib/forms/schema";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  adminClient,
  profileId,
  signedInClient,
} from "./helpers";

const admin = adminClient();
let formId: string;
let versionId: string;
const ids: string[] = [];

const opts = (...ids: string[]) =>
  ids.map((id) => ({ id, label: id.toUpperCase() }));
const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  sections: [
    {
      id: "s1",
      title: "S",
      questions: [
        {
          id: "q1",
          key: "color",
          type: "multiple_choice",
          title: "Color",
          required: true,
          options: opts("red", "green", "blue"),
        },
        {
          id: "q2",
          key: "tags",
          type: "checkboxes",
          title: "Tags",
          required: false,
          options: opts("a", "b", "c"),
        },
        {
          id: "q3",
          key: "score",
          type: "rating",
          title: "Score",
          required: true,
          rating: { max: 5 },
        },
        {
          id: "q4",
          key: "nps",
          type: "linear_scale",
          title: "NPS",
          required: true,
          scale: { min: 0, max: 10 },
        },
        { id: "q5", key: "age", type: "number", title: "Age", required: false },
        {
          id: "q6",
          key: "visit",
          type: "date",
          title: "Visit",
          required: false,
        },
        {
          id: "q7",
          key: "note",
          type: "paragraph",
          title: "Note",
          required: false,
        },
      ],
    },
  ],
};

// r: [color, tags, score, nps, age, visit, note, submitted_at, duration, device]
const ROWS: [
  string,
  string[] | null,
  number,
  number,
  number | null,
  string | null,
  string | null,
  string,
  number,
  string,
][] = [
  [
    "red",
    ["a", "b"],
    5,
    10,
    20,
    "2026-03-02",
    "great service fast",
    "2026-03-01T03:00:00Z",
    100,
    "mobile",
  ],
  [
    "red",
    ["a"],
    4,
    9,
    30,
    "2026-03-02",
    "fast service",
    "2026-03-02T03:00:00Z",
    200,
    "mobile",
  ],
  [
    "green",
    ["b", "c"],
    2,
    3,
    40,
    "2026-03-03",
    "slow queue",
    "2026-03-03T03:00:00Z",
    300,
    "desktop",
  ],
  [
    "blue",
    ["a", "b", "c"],
    1,
    6,
    50,
    null,
    "slow",
    "2026-03-04T03:00:00Z",
    400,
    "desktop",
  ],
  ["red", null, 3, 8, 60, null, null, "2026-03-05T03:00:00Z", 500, "tablet"],
  [
    "green",
    ["c"],
    5,
    10,
    null,
    null,
    null,
    "2026-03-06T03:00:00Z",
    600,
    "mobile",
  ],
];

beforeAll(async () => {
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: await profileId(DUMMY.editor),
      title: "Dashboard fixture",
      slug: `it-dash-${randomUUID().slice(0, 8)}`,
      draft_definition: DEFINITION as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error) throw error;
  formId = form.id;
  const { data: version } = await admin
    .from("form_versions")
    .insert({
      form_id: formId,
      version_number: 1,
      definition: DEFINITION as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  versionId = version!.id;
  await admin
    .from("forms")
    .update({ current_version_id: versionId, status: "published" })
    .eq("id", formId);

  for (const [
    i,
    [color, tags, score, nps, age, visit, note, at, duration, device],
  ] of ROWS.entries()) {
    const { data: r, error: rError } = await admin
      .from("responses")
      .insert({
        form_id: formId,
        form_version_id: versionId,
        submitted_at: at,
        duration_seconds: duration,
        device,
        locale: i % 2 ? "en" : "id",
        identifier_email: i === 0 ? "ani@example.com" : null,
      })
      .select("id")
      .single();
    if (rError) throw rError;
    ids.push(r.id);
    const base = { response_id: r.id, form_id: formId };
    const answers = [
      {
        ...base,
        question_key: "color",
        question_type: "multiple_choice",
        value_options: [color],
      },
      tags && {
        ...base,
        question_key: "tags",
        question_type: "checkboxes",
        value_options: tags,
      },
      {
        ...base,
        question_key: "score",
        question_type: "rating",
        value_number: score,
      },
      {
        ...base,
        question_key: "nps",
        question_type: "linear_scale",
        value_number: nps,
      },
      age !== null && {
        ...base,
        question_key: "age",
        question_type: "number",
        value_number: age,
      },
      visit && {
        ...base,
        question_key: "visit",
        question_type: "date",
        value_date: `${visit}T00:00:00Z`,
      },
      note && {
        ...base,
        question_key: "note",
        question_type: "paragraph",
        value_text: note,
      },
    ].filter(Boolean);
    const { error: aError } = await admin
      .from("response_answers")
      .insert(answers as never);
    if (aError) throw aError;
  }
});

afterAll(async () => {
  if (formId) await admin.from("forms").delete().eq("id", formId);
});

async function owner() {
  return (await signedInClient(DUMMY.editor)).client;
}

type Stats = Record<string, unknown> & { n: number; low_sample: boolean };

describe("question_stats (hand-computed)", () => {
  async function stats(key: string, filters: object = {}) {
    const { data, error } = await (
      await owner()
    ).rpc("question_stats", {
      p_form_id: formId,
      p_question_key: key,
      p_filters: filters as never,
    });
    expect(error).toBeNull();
    return data as unknown as Stats;
  }

  it("multiple choice: counts per option", async () => {
    const s = await stats("color");
    expect(s).toMatchObject({
      n: 6,
      total: 6,
      eligible: 6,
      low_sample: true,
      other: 0,
    });
    expect(s.options).toEqual([
      { id: "red", count: 3 },
      { id: "green", count: 2 },
      { id: "blue", count: 1 },
    ]);
  });

  it("checkboxes: percent of respondents, average selections, top pairs", async () => {
    const s = await stats("tags");
    expect(s.n).toBe(5);
    // a: r1 r2 r4 / b: r1 r3 r4 / c: r3 r4 r6 -> 3 of 5 each
    expect(s.options).toEqual([
      { id: "a", count: 3, percent: 60 },
      { id: "b", count: 3, percent: 60 },
      { id: "c", count: 3, percent: 60 },
    ]);
    expect(s.avg_selections).toBe(1.8); // (2+1+2+3+1)/5
    expect(s.pairs).toEqual([
      { a: "a", b: "b", count: 2 },
      { a: "b", b: "c", count: 2 },
      { a: "a", b: "c", count: 1 },
    ]);
  });

  it("rating: mean, median, CSAT, distribution", async () => {
    const s = await stats("score");
    // 5,4,2,1,3,5
    expect(s).toMatchObject({
      n: 6,
      mean: 3.33,
      median: 3.5,
      csat: 50,
      nps: null,
      min: 1,
      max: 5,
    });
    expect(s.distribution).toEqual(
      [1, 2, 3, 4, 5].map((value) => ({ value, count: value === 5 ? 2 : 1 })),
    );
  });

  it("0–10 scale: NPS", async () => {
    const s = await stats("nps");
    // 10,9,3,6,8,10: promoters 3, passives 1 (8), detractors 2 -> (3-2)/6 = 16.7
    expect(s).toMatchObject({
      n: 6,
      promoters: 3,
      passives: 1,
      detractors: 2,
      nps: 16.7,
      csat: null,
    });
  });

  it("number: quantiles and Sturges histogram", async () => {
    const s = await stats("age");
    // 20,30,40,50,60; k = ceil(log2(5)+1) = 4 buckets of width 10 (max goes in the last)
    expect(s).toMatchObject({
      n: 5,
      min: 20,
      max: 60,
      mean: 40,
      median: 40,
      p25: 30,
      p75: 50,
      p90: 56,
    });
    expect((s.histogram as { count: number }[]).map((b) => b.count)).toEqual([
      1, 1, 1, 2,
    ]);
  });

  it("date: weekday distribution", async () => {
    const s = await stats("visit");
    expect(s.n).toBe(3);
    const weekdays = s.weekdays as { dow: number; count: number }[];
    expect(weekdays.find((w) => w.dow === 1)?.count).toBe(2); // 2026-03-02 is a Monday
    expect(weekdays.find((w) => w.dow === 2)?.count).toBe(1);
  });

  it("text: top terms per answer", async () => {
    const s = await stats("note");
    expect(s.n).toBe(4);
    expect((s.terms as { term: string; count: number }[]).slice(0, 5)).toEqual([
      { term: "fast", count: 2 },
      { term: "service", count: 2 },
      { term: "slow", count: 2 },
      { term: "great", count: 1 },
      { term: "queue", count: 1 },
    ]);
  });

  it("answer, device and date filters", async () => {
    const red = await stats("score", {
      answers: [{ questionKey: "color", operator: "any_of", values: ["red"] }],
    });
    expect(red).toMatchObject({ n: 3, mean: 4 }); // 5,4,3
    const mobile = await stats("score", { device: "mobile" });
    expect(mobile.n).toBe(3);
    const window = await stats("color", {
      from: "2026-03-02T00:00:00Z",
      to: "2026-03-04T00:00:00Z",
    });
    expect(window.n).toBe(2); // r2, r3
    const highScore = await stats("color", {
      answers: [{ questionKey: "score", operator: "any_of", values: ["5"] }],
    });
    expect(highScore.n).toBe(2);
  });
});

describe("dashboard_bundle / overview", () => {
  it("returns overview and every question in one call", async () => {
    const { data, error } = await (
      await owner()
    ).rpc("dashboard_bundle", { p_form_id: formId, p_filters: {} });
    expect(error).toBeNull();
    const bundle = data as unknown as {
      overview: Record<string, unknown> & {
        duration: { median: number; mean: number };
      };
      questions: Record<string, Stats>;
      form: { creator: string };
    };
    expect(bundle.overview).toMatchObject({ total: 6, n: 6, low_sample: true });
    expect(bundle.overview.duration).toMatchObject({
      n: 6,
      mean: 350,
      median: 350,
    });
    expect(bundle.overview.devices).toEqual([
      { key: "mobile", count: 3 },
      { key: "desktop", count: 2 },
      { key: "tablet", count: 1 },
    ]);
    expect(bundle.overview.versions).toEqual([
      expect.objectContaining({ id: versionId, number: 1, count: 6 }),
    ]);
    expect(Object.keys(bundle.questions).sort()).toEqual([
      "age",
      "color",
      "note",
      "nps",
      "score",
      "tags",
      "visit",
    ]);
    expect(bundle.questions.color).toMatchObject({
      n: 6,
      version_numbers: [1],
      in_current: true,
    });
    expect(bundle.form.creator).toBe("Dummy Editor");
  });

  it("compares with the previous period of the same length", async () => {
    const { data } = await (
      await owner()
    ).rpc("dashboard_overview", {
      p_form_id: formId,
      p_filters: {
        from: "2026-03-04T00:00:00Z",
        to: "2026-03-07T00:00:00Z",
      } as never,
    });
    expect(data).toMatchObject({ total: 3, previous_period: 3 }); // r4-r6 vs r1-r3
  });
});

describe("cross_stats", () => {
  it("categorical x rating: average per group", async () => {
    const { data } = await (
      await owner()
    ).rpc("cross_stats", {
      p_form_id: formId,
      p_question_a: "score",
      p_question_b: "color",
    });
    const s = data as unknown as {
      kind: string;
      groups: { option: string; mean: number; n: number }[];
      n: number;
    };
    expect(s.kind).toBe("cat_num");
    expect(s.n).toBe(6);
    expect(s.groups).toEqual([
      expect.objectContaining({ option: "red", mean: 4, n: 3 }),
      expect.objectContaining({ option: "green", mean: 3.5, n: 2 }),
      expect.objectContaining({ option: "blue", mean: 1, n: 1 }),
    ]);
  });

  it("number x number: no Pearson r below 30 pairs", async () => {
    const { data } = await (
      await owner()
    ).rpc("cross_stats", {
      p_form_id: formId,
      p_question_a: "age",
      p_question_b: "score",
    });
    expect(data).toMatchObject({
      kind: "num_num",
      n: 5,
      r: null,
      low_sample: true,
    });
  });

  it("categorical x categorical: contingency table", async () => {
    const { data } = await (
      await owner()
    ).rpc("cross_stats", {
      p_form_id: formId,
      p_question_a: "color",
      p_question_b: "tags",
    });
    const s = data as unknown as {
      kind: string;
      cells: { a: string; b: string; count: number }[];
    };
    expect(s.kind).toBe("cat_cat");
    expect(s.cells).toContainEqual({ a: "red", b: "a", count: 2 }); // r1, r2
    expect(s.cells).toContainEqual({ a: "green", b: "c", count: 2 }); // r3, r6
  });
});

describe("responses listing", () => {
  it("keyset-paginates and shows full identifiers to editors", async () => {
    const client = await owner();
    const first = await client.rpc("list_responses", {
      p_form_id: formId,
      p_limit: 4,
    });
    const page1 = first.data as unknown as {
      total: number;
      rows: { id: string; identifier: string | null }[];
      next_cursor: object;
      identifiers_masked: boolean;
    };
    expect(page1.total).toBe(6);
    expect(page1.rows.map((r) => r.id)).toEqual([
      ids[5],
      ids[4],
      ids[3],
      ids[2],
    ]);
    expect(page1.identifiers_masked).toBe(false);
    const second = await client.rpc("list_responses", {
      p_form_id: formId,
      p_limit: 4,
      p_cursor: page1.next_cursor as never,
    });
    const page2 = second.data as unknown as typeof page1;
    expect(page2.rows.map((r) => r.id)).toEqual([ids[1], ids[0]]);
    expect(page2.next_cursor).toBeNull();
    expect(page2.rows[1].identifier).toBe("ani@example.com");

    const searched = await client.rpc("list_responses", {
      p_form_id: formId,
      p_search: "queue",
    });
    expect(
      (searched.data as unknown as typeof page1).rows.map((r) => r.id),
    ).toEqual([ids[2]]);
  });
});

describe("access", () => {
  it("a viewer without a share cannot call the RPCs", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const calls = [
      client.rpc("dashboard_bundle", { p_form_id: formId }),
      client.rpc("dashboard_overview", { p_form_id: formId }),
      client.rpc("question_stats", {
        p_form_id: formId,
        p_question_key: "color",
      }),
      client.rpc("cross_stats", {
        p_form_id: formId,
        p_question_a: "color",
        p_question_b: "score",
      }),
      client.rpc("cross_suggestions", { p_form_id: formId }),
      client.rpc("list_responses", { p_form_id: formId }),
      client.rpc("get_response", { p_response_id: ids[0] }),
      client.rpc("question_text_answers", {
        p_form_id: formId,
        p_question_key: "note",
      }),
    ];
    for (const { error } of await Promise.all(calls))
      expect(error?.code).toBe("42501");
  });

  it("a shared viewer sees stats but masked identifiers, and cannot read identifier columns", async () => {
    const viewerId = await profileId(DUMMY.viewer);
    await admin
      .from("form_members")
      .insert({ form_id: formId, user_id: viewerId, role: "viewer" });
    const { client } = await signedInClient(DUMMY.viewer);
    const bundle = await client.rpc("dashboard_bundle", { p_form_id: formId });
    expect(bundle.error).toBeNull();
    const detail = await client.rpc("get_response", { p_response_id: ids[0] });
    expect(detail.data).toMatchObject({
      identifier_email: "a***@example.com",
      identifiers_masked: true,
    });
    const direct = await client
      .from("responses")
      .select("identifier_email")
      .eq("form_id", formId);
    expect(direct.error?.code).toBe("42501");
    const allowed = await client
      .from("responses")
      .select("id, submitted_at")
      .eq("form_id", formId);
    expect(allowed.data).toHaveLength(6);
    await admin
      .from("form_members")
      .delete()
      .eq("form_id", formId)
      .eq("user_id", viewerId);
  });

  it("only the secret key can generate demo data", async () => {
    const { error } = await (
      await owner()
    ).rpc("generate_demo_responses", { p_form_id: formId, p_n: 1, p_days: 1 });
    expect(error?.code).toBe("42501");
  });
});
