/**
 * Chart builder RPC (dashboard_query) against a 6-response fixture with
 * hand-computed values.
 *
 *   #  color  tags     score nps age visit       note                 submitted (UTC)   dur device  locale
 *   0  red    a,b      5     10  20  2026-03-02  great service fast   03-01 03:00       100 mobile  id
 *   1  red    a        4     9   30  2026-03-02  fast service         03-02 03:00       200 mobile  en
 *   2  green  b,c      2     3   40  2026-03-03  slow queue           03-03 03:00       300 desktop id
 *   3  blue   a,b,c    1     6   50  -           slow                 03-04 03:00       400 desktop en
 *   4  red    -        3     8   60  -           -                    03-05 03:00       500 tablet  id
 *   5  green  c        5     10  -   -           -                    03-06 03:00       600 mobile  en
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptySpec, type ChartSpec } from "@/lib/analytics/chart-spec";
import type { FormDefinition } from "@/lib/forms/schema";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  adminClient,
  anonClient,
  profileId,
  signedInClient,
} from "./helpers";

const admin = adminClient();
let formId: string;
let editor: Awaited<ReturnType<typeof signedInClient>>;

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
        {
          id: "q8",
          key: "mail",
          type: "email",
          title: "Email",
          required: false,
        },
      ],
    },
  ],
};

const ROWS = [
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
] as const;

const q = (key: string) => ({ kind: "question" as const, key });
const meta = (
  field: "submitted_at" | "device" | "locale" | "version" | "duration",
) => ({
  kind: "meta" as const,
  field,
});

type Grouped = {
  rows: (string | number | null)[][];
  total: number;
  groups: number;
  bins: Record<string, { lo: number; hi: number; n: number }>;
};

async function run(
  patch: Partial<ChartSpec>,
  filters: Record<string, unknown> = {},
  client = editor.client,
) {
  const spec = { ...emptySpec("bar"), ...patch };
  return client.rpc("dashboard_query", {
    p_form_id: formId,
    p_spec: spec as never,
    p_filters: filters as never,
  });
}

async function grouped(
  patch: Partial<ChartSpec>,
  filters: Record<string, unknown> = {},
) {
  const { data, error } = await run(patch, filters);
  if (error) throw error;
  return data as unknown as Grouped;
}

beforeAll(async () => {
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: await profileId(DUMMY.editor),
      title: "Chart query fixture",
      slug: `it-chart-${randomUUID().slice(0, 8)}`,
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
  await admin
    .from("forms")
    .update({ current_version_id: version!.id, status: "published" })
    .eq("id", formId);

  for (const [
    i,
    [color, tags, score, nps, age, visit, note, at, duration, device],
  ] of ROWS.entries()) {
    const { data: r, error: rError } = await admin
      .from("responses")
      .insert({
        form_id: formId,
        form_version_id: version!.id,
        submitted_at: at,
        duration_seconds: duration,
        device,
        locale: i % 2 ? "en" : "id",
      })
      .select("id")
      .single();
    if (rError) throw rError;
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
        value_options: [...tags],
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
      {
        ...base,
        question_key: "mail",
        question_type: "email",
        value_text: `p${i}@example.com`,
      },
    ].filter(Boolean);
    const { error: aError } = await admin
      .from("response_answers")
      .insert(answers as never);
    if (aError) throw aError;
  }
  editor = await signedInClient(DUMMY.editor);
});

afterAll(async () => {
  if (formId) await admin.from("forms").delete().eq("id", formId);
});

describe("dashboard_query: one dimension", () => {
  it("counts responses per option, largest first", async () => {
    const r = await grouped({ dimensions: [{ field: q("color") }] });
    expect(r.rows).toEqual([
      ["red", 3],
      ["green", 2],
      ["blue", 1],
    ]);
    expect(r.total).toBe(6);
    expect(r.groups).toBe(3);
  });

  it("averages a numeric question per group", async () => {
    const r = await grouped({
      dimensions: [{ field: q("color") }],
      metrics: [{ agg: "avg", field: q("score") }],
    });
    // red (5+4+3)/3, green (2+5)/2, blue 1
    expect(r.rows).toEqual([
      ["red", 4],
      ["green", 3.5],
      ["blue", 1],
    ]);
  });

  it("counts each selected checkbox option; percent of all responses", async () => {
    const r = await grouped({
      dimensions: [{ field: q("tags") }],
      metrics: [{ agg: "count" }, { agg: "percent" }],
      sort: { by: "dimension", dir: "asc" },
    });
    expect(r.rows).toEqual([
      ["a", 3, 50],
      ["b", 3, 50],
      ["c", 3, 50],
    ]);
  });

  it("groups submission time by Jakarta day and dates by month", async () => {
    const days = await grouped({
      dimensions: [{ field: meta("submitted_at"), grain: "day" }],
      sort: { by: "dimension", dir: "asc" },
    });
    expect(days.rows.map((r) => r[0])).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
    const months = await grouped({
      dimensions: [{ field: q("visit"), grain: "month" }],
    });
    expect(months.rows).toEqual([["2026-03", 3]]);
  });

  it("includes '(no answer)' only when asked", async () => {
    const r = await grouped({
      dimensions: [{ field: q("visit"), grain: "day" }],
      sort: { by: "dimension", dir: "asc" },
      options: { includeEmpty: true },
    });
    expect(r.rows).toEqual([
      ["2026-03-02", 2],
      ["2026-03-03", 1],
      [null, 3],
    ]);
  });

  it("bins numbers into equal ranges (histogram)", async () => {
    const r = await grouped({
      chart: "histogram",
      dimensions: [{ field: q("age"), bins: 4 }],
      sort: { by: "dimension", dir: "asc" },
    });
    // 20..60 in 4 ranges of 10: 20 | 30 | 40 | 50, 60 (the maximum joins the last range)
    expect(r.bins["0"]).toEqual({ lo: 20, hi: 60, n: 4 });
    expect(r.rows).toEqual([
      ["1", 1],
      ["2", 1],
      ["3", 1],
      ["4", 2],
    ]);
  });

  it("sorts numeric dimensions numerically and limits to the top N", async () => {
    const r = await grouped({
      dimensions: [{ field: q("score") }],
      sort: { by: "dimension", dir: "desc" },
    });
    expect(r.rows.map((x) => x[0])).toEqual(["5", "4", "3", "2", "1"]);
    const top = await grouped({ dimensions: [{ field: q("note") }], limit: 2 });
    expect(top.rows).toHaveLength(2);
    expect(top.groups).toBe(4);
  });
});

describe("dashboard_query: metrics, filters, two dimensions", () => {
  it("computes NPS, CSAT and summary metrics without dimensions", async () => {
    const { rows } = await grouped({
      chart: "table",
      dimensions: [],
      metrics: [
        { agg: "count" },
        { agg: "nps", field: q("nps") }, // promoters 3 (10, 9, 10), detractors 2 (3, 6) of 6
        { agg: "csat", field: q("score") }, // 5, 4, 5 of 6
        { agg: "median", field: meta("duration") },
        { agg: "max", field: q("age") },
      ],
    });
    expect(rows).toEqual([[6, 16.7, 50, 350, 60]]);
  });

  it("applies chart filters and the global dashboard filters", async () => {
    const color = { dimensions: [{ field: q("color") }] };
    expect(
      (
        await grouped({
          ...color,
          filters: [{ field: meta("device"), op: "in", values: ["mobile"] }],
        })
      ).rows,
    ).toEqual([
      ["red", 2],
      ["green", 1],
    ]);
    expect(
      (
        await grouped({
          ...color,
          filters: [{ field: q("color"), op: "not_in", values: ["red"] }],
        })
      ).total,
    ).toBe(3);
    expect(
      (
        await grouped({
          ...color,
          filters: [{ field: q("score"), op: "gt", values: [3] }],
        })
      ).total,
    ).toBe(3);
    expect(
      (
        await grouped({
          ...color,
          filters: [{ field: q("tags"), op: "is_empty" }],
        })
      ).rows,
    ).toEqual([["red", 1]]);
    expect((await grouped(color, { device: "desktop" })).rows).toEqual([
      ["blue", 1],
      ["green", 1],
    ]);
  });

  it("breaks down by a second dimension, ranking the first by its total", async () => {
    const r = await grouped({
      chart: "column",
      dimensions: [{ field: q("color") }, { field: meta("device") }],
    });
    expect(r.rows).toEqual([
      ["red", "mobile", 2],
      ["red", "tablet", 1],
      ["green", "desktop", 1],
      ["green", "mobile", 1],
      ["blue", "desktop", 1],
    ]);
  });

  it("builds pivot cells (checkbox options x language)", async () => {
    const r = await grouped({
      chart: "pivot",
      dimensions: [{ field: q("tags") }, { field: meta("locale") }],
      sort: { by: "dimension", dir: "asc" },
    });
    expect(r.rows).toEqual([
      ["a", "en", 2],
      ["a", "id", 1],
      ["b", "en", 1],
      ["b", "id", 2],
      ["c", "en", 2],
      ["c", "id", 1],
    ]);
  });

  it("returns scatter points with Pearson r", async () => {
    const { data, error } = await run({
      chart: "scatter",
      dimensions: [],
      metrics: [],
      x: q("age"),
      y: q("score"),
    });
    expect(error).toBeNull();
    const r = data as unknown as { n: number; r: number; points: number[][] };
    expect(r.n).toBe(5);
    expect(r.r).toBe(-0.7); // cov -70 / sqrt(1000 * 10)
    expect(r.points).toContainEqual([60, 3]);
  });
});

describe("dashboard_query: safety", () => {
  it("rejects email / phone fields, unknown keys and bad specs", async () => {
    for (const patch of [
      { dimensions: [{ field: q("mail") }] },
      { dimensions: [{ field: q("nope") }] },
      {
        dimensions: [{ field: q("color") }],
        metrics: [{ agg: "avg" as const, field: q("color") }],
      },
      { chart: "pivot" as const, dimensions: [{ field: q("color") }] },
      {
        dimensions: [{ field: q("color") }],
        filters: [{ field: q("mail"), op: "is_answered" as const }],
      },
    ]) {
      const { error } = await run(patch);
      expect(error?.code, JSON.stringify(patch)).toBe("22023");
    }
  });

  it("treats filter values as data, never as SQL", async () => {
    const r = await grouped({
      dimensions: [{ field: q("color") }],
      filters: [
        { field: q("note"), op: "in", values: ["x') or true --", "slow"] },
      ],
    });
    expect(r.rows).toEqual([["blue", 1]]);
  });

  it("is denied without view access", async () => {
    const viewer = await signedInClient(DUMMY.viewer);
    const { error } = await run(
      { dimensions: [{ field: q("color") }] },
      {},
      viewer.client,
    );
    expect(error?.code).toBe("42501");
    const { error: anonError } = await anonClient().rpc("dashboard_query", {
      p_form_id: formId,
      p_spec: emptySpec() as never,
    });
    expect(anonError).not.toBeNull();
  });
});

describe("public dashboard charts (share link API)", () => {
  // Needs the app running at APP_URL (like the other HTTP-level tests).
  const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
  const token = randomBytes(32).toString("base64url");
  const widget = (id: string, custom: ChartSpec) => ({
    id,
    kind: "custom",
    origin: "user",
    custom,
    layout: { x: 0, y: 0, w: 6, h: 10 },
  });

  beforeAll(async () => {
    const config = {
      configVersion: 1,
      knownKeys: [],
      widgets: [
        widget("custom:color", {
          ...emptySpec("bar"),
          dimensions: [{ field: q("color") }],
        }),
        widget("custom:note", {
          ...emptySpec("table"),
          dimensions: [{ field: q("note") }],
        }),
        { ...widget("custom:hidden", emptySpec("kpi")), hidden: true },
      ],
    };
    const { error } = await admin.from("dashboards").upsert({
      form_id: formId,
      config: config as unknown as NonNullable<Json>,
    });
    if (error) throw error;
    const { error: shareError } = await admin
      .from("dashboard_shares")
      .insert({ form_id: formId, token, include_text_answers: false });
    if (shareError) throw shareError;
  });

  const get = (params: string) =>
    fetch(`${APP_URL}/api/d/${token}/stats?${params}`, { cache: "no-store" });

  it("runs only charts saved in the dashboard, by widget id", async () => {
    const res = await get("fn=chart&widget=custom%3Acolor");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Grouped;
    expect(body.rows).toEqual([
      ["red", 3],
      ["green", 2],
      ["blue", 1],
    ]);
    // The date range of the public filter bar applies.
    const ranged = await get(
      `fn=chart&widget=custom%3Acolor&from=${encodeURIComponent("2026-03-04T00:00:00Z")}`,
    );
    expect(((await ranged.json()) as Grouped).total).toBe(3);
  });

  it("refuses unknown or hidden widgets and hidden free text", async () => {
    expect((await get("fn=chart&widget=custom%3Anope")).status).toBe(404);
    expect((await get("fn=chart&widget=custom%3Ahidden")).status).toBe(404);
    expect((await get("fn=chart&widget=custom%3Anote")).status).toBe(403);
    expect((await get("fn=chart&widget=bad%20id")).status).toBe(400);
  });
});
