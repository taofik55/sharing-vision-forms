import { describe, expect, it } from "vitest";
import {
  historyReducer,
  initHistory,
  COALESCE_MS,
  HISTORY_LIMIT,
} from "@/components/builder/history";
import { parseFormsQuery } from "@/lib/forms/list-query";
import { formSettingsSchema, nextStatus } from "@/lib/forms/settings";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/forms/slug";
import { jakartaLocalToUtcIso, utcIsoToJakartaLocal } from "@/lib/time";
import { form, question } from "./fixtures";

const defs = Array.from({ length: 5 }, (_, i) =>
  form(question({ key: `q${i}`, type: "short_text" })),
);

describe("historyReducer", () => {
  it("undoes and redoes", () => {
    let s = initHistory(defs[0]);
    s = historyReducer(s, { type: "apply", definition: defs[1], now: 0 });
    s = historyReducer(s, { type: "apply", definition: defs[2], now: 5000 });
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(defs[1]);
    s = historyReducer(s, { type: "undo" });
    expect(s.present).toBe(defs[0]);
    expect(historyReducer(s, { type: "undo" })).toBe(s);
    s = historyReducer(s, { type: "redo" });
    s = historyReducer(s, { type: "redo" });
    expect(s.present).toBe(defs[2]);
  });

  it("coalesces rapid edits with the same key into one step", () => {
    let s = initHistory(defs[0]);
    s = historyReducer(s, {
      type: "apply",
      definition: defs[1],
      coalesceKey: "title",
      now: 0,
    });
    s = historyReducer(s, {
      type: "apply",
      definition: defs[2],
      coalesceKey: "title",
      now: 100,
    });
    s = historyReducer(s, {
      type: "apply",
      definition: defs[3],
      coalesceKey: "title",
      now: 200,
    });
    expect(s.past).toEqual([defs[0]]);
    s = historyReducer(s, {
      type: "apply",
      definition: defs[4],
      coalesceKey: "title",
      now: 200 + COALESCE_MS + 1,
    });
    expect(s.past).toEqual([defs[0], defs[3]]);
  });

  it("a new edit clears redo and history is capped", () => {
    let s = initHistory(defs[0]);
    s = historyReducer(s, { type: "apply", definition: defs[1] });
    s = historyReducer(s, { type: "undo" });
    s = historyReducer(s, { type: "apply", definition: defs[2] });
    expect(s.future).toEqual([]);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      s = historyReducer(s, {
        type: "apply",
        definition: form(question({ key: `x${i}`, type: "short_text" })),
      });
    }
    expect(s.past.length).toBe(HISTORY_LIMIT);
  });
});

describe("slug", () => {
  it.each([
    ["Survei Kepuasan Pelanggan 2026!", "survei-kepuasan-pelanggan-2026"],
    ["  Café  Déjà vu ", "cafe-deja-vu"],
    ["!!", "form"],
    ["ab", "form-ab"],
  ])("slugify(%s) = %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
    expect(isValidSlug(slugify(input))).toBe(true);
  });

  it("uniqueSlug adds a random suffix", () => {
    const a = uniqueSlug("Event Registration");
    expect(a).toMatch(/^event-registration-[a-z0-9]{6}$/);
    expect(isValidSlug(a)).toBe(true);
    expect(uniqueSlug("Event Registration")).not.toBe(a);
  });

  it.each(["ab", "-abc", "abc-", "a--b", "ABC", "a_b", "a".repeat(81)])(
    "rejects %s",
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});

describe("Asia/Jakarta conversion", () => {
  it("converts wall time to UTC and back", () => {
    expect(jakartaLocalToUtcIso("2026-10-13T17:30")).toBe(
      "2026-10-13T10:30:00.000Z",
    );
    expect(jakartaLocalToUtcIso("2026-01-01T03:00")).toBe(
      "2025-12-31T20:00:00.000Z",
    );
    expect(utcIsoToJakartaLocal("2025-12-31T20:00:00+00:00")).toBe(
      "2026-01-01T03:00",
    );
    expect(utcIsoToJakartaLocal(null)).toBe("");
  });

  it("rejects invalid input", () => {
    expect(jakartaLocalToUtcIso("2026-02-30T10:00")).toBeNull();
    expect(jakartaLocalToUtcIso("2026-02-10 10:00")).toBeNull();
    expect(jakartaLocalToUtcIso("2026-02-10T25:00")).toBeNull();
  });
});

describe("nextStatus", () => {
  it("allows only sensible transitions", () => {
    expect(nextStatus("published", "close", true)).toBe("closed");
    expect(nextStatus("draft", "close", false)).toBeNull();
    expect(nextStatus("closed", "reopen", true)).toBe("published");
    expect(nextStatus("published", "reopen", true)).toBeNull();
    expect(nextStatus("draft", "archive", false)).toBe("archived");
    expect(nextStatus("archived", "archive", false)).toBeNull();
    expect(nextStatus("archived", "restore", true)).toBe("closed");
    expect(nextStatus("archived", "restore", false)).toBe("draft");
  });
});

describe("formSettingsSchema", () => {
  const valid = {
    title: "T",
    description: "",
    slug: "My-Form",
    identifierMode: "email",
    deadlineLocal: "",
    closedMessage: "",
    thankYouMessage: "",
  };
  it("normalizes the slug and accepts an empty deadline", () => {
    expect(formSettingsSchema.parse(valid).slug).toBe("my-form");
  });
  it.each([
    { title: " " },
    { slug: "a b" },
    { deadlineLocal: "tomorrow" },
    { identifierMode: "fax" },
  ])("rejects %j", (patch) => {
    expect(formSettingsSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  });
});

describe("parseFormsQuery", () => {
  it("falls back to defaults for invalid values", () => {
    expect(
      parseFormsQuery({
        status: "bogus",
        sort: "x",
        page: "-3",
        owner: "nope",
        view: "grid",
      }),
    ).toEqual({
      q: "",
      status: null,
      owner: null,
      scope: "all",
      sort: "updated_desc",
      view: "table",
      page: 1,
    });
  });
  it("parses valid values", () => {
    expect(
      parseFormsQuery({
        q: " survey ",
        status: "published",
        scope: "mine",
        sort: "title_asc",
        page: "3",
        view: "cards",
      }),
    ).toMatchObject({
      q: "survey",
      status: "published",
      scope: "mine",
      sort: "title_asc",
      page: 3,
      view: "cards",
    });
  });
});
