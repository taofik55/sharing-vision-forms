import { describe, expect, it } from "vitest";
import { migrateDraftAnswers } from "@/lib/forms/drafts";
import {
  buildIdentifier,
  normalizeEmail,
  normalizePhone,
} from "@/lib/forms/identifier";
import { OTHER_OPTION_ID } from "@/lib/forms/schema";
import {
  detectDevice,
  durationSeconds,
  prepareAnswers,
  submitPayloadSchema,
  toAnswerRows,
} from "@/lib/forms/submission";
import { getClientIp, hashIp } from "@/lib/rate-limit";
import { form, question, twoSectionForm, yesNo } from "./fixtures";

describe("normalizePhone (Indonesian rules)", () => {
  it.each([
    ["0812-3456-7890", "6281234567890"],
    ["0812 3456 789", "628123456789"],
    ["+62 812 3456 7890", "6281234567890"],
    ["+62-812-3456-7890", "6281234567890"],
    ["62 812 3456 7890", "6281234567890"],
    ["0062 812 3456 7890", "6281234567890"],
    ["+62 0812 3456 7890", "6281234567890"],
    ["812 3456 7890", "6281234567890"],
    ["(021) 555-1234", "62215551234"],
    ["021.5551234", "62215551234"],
    ["+1 (415) 555-2671", "14155552671"],
    ["+44 20 7946 0958", "442079460958"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "12345",
    "0812",
    "abc",
    "0812-3456-7890 ext 5",
    "+62+812345678",
    "081234567890123456",
    "62 81+2345678",
  ])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ani.Wijaya@Example.CO.ID ")).toBe(
      "ani.wijaya@example.co.id",
    );
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("buildIdentifier", () => {
  it("none needs nothing", () => {
    expect(buildIdentifier("none", { email: "x" })).toEqual({
      ok: true,
      identifier: { email: null, phone: null, key: null },
    });
  });

  it("email mode requires a valid email", () => {
    expect(buildIdentifier("email", {})).toMatchObject({
      ok: false,
      errors: { email: "emailRequired" },
    });
    expect(buildIdentifier("email", { email: "nope" })).toMatchObject({
      ok: false,
      errors: { email: "invalidEmail" },
    });
    expect(
      buildIdentifier("email", { email: " A@B.co ", phone: "0812345678" }),
    ).toEqual({
      ok: true,
      identifier: { email: "a@b.co", phone: null, key: "a@b.co" },
    });
  });

  it("phone mode requires a valid phone", () => {
    expect(buildIdentifier("phone", {})).toMatchObject({
      ok: false,
      errors: { phone: "phoneRequired" },
    });
    expect(buildIdentifier("phone", { phone: "123" })).toMatchObject({
      ok: false,
      errors: { phone: "invalidPhone" },
    });
    expect(buildIdentifier("phone", { phone: "0812-1111-2222" })).toEqual({
      ok: true,
      identifier: { email: null, phone: "6281211112222", key: "6281211112222" },
    });
  });

  it("email_or_phone needs at least one and prefers email as key", () => {
    expect(buildIdentifier("email_or_phone", {})).toMatchObject({ ok: false });
    expect(
      buildIdentifier("email_or_phone", { phone: "081211112222" }),
    ).toMatchObject({
      ok: true,
      identifier: { key: "6281211112222" },
    });
    expect(
      buildIdentifier("email_or_phone", {
        email: "a@b.co",
        phone: "081211112222",
      }),
    ).toEqual({
      ok: true,
      identifier: { email: "a@b.co", phone: "6281211112222", key: "a@b.co" },
    });
    expect(
      buildIdentifier("email_or_phone", { email: "a@b.co", phone: "12" }),
    ).toMatchObject({
      ok: false,
      errors: { phone: "invalidPhone" },
    });
  });
});

describe("prepareAnswers", () => {
  const def = form(
    question({
      key: "ask",
      type: "multiple_choice",
      options: yesNo,
      required: true,
    }),
    question({
      key: "why",
      type: "paragraph",
      required: true,
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "ask", operator: "equals", value: "yes" }],
      },
    }),
    question({ key: "note", type: "short_text" }),
  );

  it("strips hidden questions and unknown keys", () => {
    const result = prepareAnswers(def, {
      ask: { selected: ["no"] },
      why: "hidden but stale",
      note: "  kept ",
      injected: "x",
    } as never);
    expect(result).toMatchObject({
      ok: true,
      answers: { ask: { selected: ["no"] }, note: "kept" },
    });
    expect(result.ok && Object.keys(result.answers)).toEqual(["ask", "note"]);
  });

  it("requires visible required questions", () => {
    expect(prepareAnswers(def, { ask: { selected: ["yes"] } })).toEqual({
      ok: false,
      errors: { why: "required" },
    });
  });

  it("rejects text over 5000 characters", () => {
    expect(
      prepareAnswers(def, {
        ask: { selected: ["yes"] },
        why: "x".repeat(5001),
      }),
    ).toEqual({
      ok: false,
      errors: { why: "tooLong" },
    });
  });
});

describe("toAnswerRows (typed columns)", () => {
  const def = twoSectionForm(
    [
      question({ key: "st", type: "short_text" }),
      question({ key: "pa", type: "paragraph" }),
      question({ key: "em", type: "email" }),
      question({ key: "ph", type: "phone" }),
      question({ key: "nu", type: "number" }),
      question({ key: "ra", type: "rating", rating: { max: 5 } }),
    ],
    [
      question({ key: "ls", type: "linear_scale", scale: { min: 0, max: 10 } }),
      question({ key: "da", type: "date" }),
      question({
        key: "mc",
        type: "multiple_choice",
        options: yesNo,
        allowOther: true,
      }),
      question({ key: "dd", type: "dropdown", options: yesNo }),
      question({ key: "cb", type: "checkboxes", options: yesNo }),
      question({ key: "empty", type: "short_text" }),
    ],
  );

  it("maps every type to the right column and stores option ids", () => {
    const rows = toAnswerRows(def, {
      st: "a",
      pa: "b",
      em: "x@y.z",
      ph: "0812",
      nu: 4.5,
      ra: 5,
      ls: 0,
      da: "2026-03-01",
      mc: { selected: [OTHER_OPTION_ID], otherText: "custom" },
      dd: { selected: ["no"] },
      cb: { selected: ["yes", "no"] },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.question_key, r]));
    const nulls = {
      value_text: null,
      value_number: null,
      value_date: null,
      value_options: null,
    };
    expect(byKey.st).toEqual({
      question_key: "st",
      question_type: "short_text",
      ...nulls,
      value_text: "a",
    });
    expect(byKey.pa.value_text).toBe("b");
    expect(byKey.em.value_text).toBe("x@y.z");
    expect(byKey.ph.value_text).toBe("0812");
    expect(byKey.nu).toMatchObject({ value_number: 4.5, value_text: null });
    expect(byKey.ra.value_number).toBe(5);
    expect(byKey.ls.value_number).toBe(0);
    expect(byKey.da).toMatchObject({
      value_date: "2026-03-01T00:00:00.000Z",
      value_text: null,
    });
    expect(byKey.mc).toMatchObject({
      value_options: [OTHER_OPTION_ID],
      value_text: "custom",
    });
    expect(byKey.dd).toMatchObject({ value_options: ["no"], value_text: null });
    expect(byKey.cb.value_options).toEqual(["yes", "no"]);
    expect(byKey.empty).toBeUndefined();
    expect(rows).toHaveLength(11);
  });
});

describe("migrateDraftAnswers", () => {
  it("keeps answers by key and drops removed or incompatible ones", () => {
    const current = form(
      question({ key: "kept", type: "short_text" }),
      question({ key: "retyped", type: "number" }),
      question({
        key: "choice",
        type: "dropdown",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }),
    );
    const result = migrateDraftAnswers(
      {
        kept: "hello",
        retyped: "was text",
        choice: { selected: ["removed-option"] },
        gone: "x",
      },
      current,
    );
    expect(result.answers).toEqual({ kept: "hello" });
    expect(result.dropped.sort()).toEqual(["choice", "gone", "retyped"]);
  });
});

describe("submitPayloadSchema", () => {
  const base = {
    versionId: "6f9619ff-8b86-4011-b42d-00c04fc964ff",
    answers: {},
    submissionToken: "6f9619ff-8b86-4011-b42d-00c04fc964fe",
    startedAt: 1_700_000_000_000,
  };
  it("defaults the locale and accepts optional fields", () => {
    expect(submitPayloadSchema.parse({ ...base, locale: "fr" }).locale).toBe(
      "id",
    );
  });
  it.each([
    { versionId: "x" },
    { submissionToken: undefined },
    { startedAt: "soon" },
  ])("rejects %j", (patch) => {
    expect(submitPayloadSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
});

describe("misc", () => {
  it("detects devices", () => {
    expect(
      detectDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
      ),
    ).toBe("mobile");
    expect(
      detectDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"),
    ).toBe("mobile");
    expect(detectDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(
      "tablet",
    );
    expect(detectDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "desktop",
    );
    expect(detectDevice(null)).toBe("unknown");
  });

  it("clamps durations", () => {
    expect(durationSeconds(1000, 61_000)).toBe(60);
    expect(durationSeconds(5000, 1000)).toBe(0);
  });

  it("hashes IPs with the salt and never returns the raw IP", () => {
    const a = hashIp("203.0.113.7", "form");
    expect(a).not.toContain("203");
    expect(a).toHaveLength(32);
    expect(hashIp("203.0.113.7", "form")).toBe(a);
    expect(hashIp("203.0.113.7", "other")).not.toBe(a);
  });

  it("reads the client IP from proxy headers", () => {
    expect(
      getClientIp(
        new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }),
      ),
    ).toBe("1.1.1.1");
    expect(
      getClientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" })),
    ).toBe("2.2.2.2");
    expect(getClientIp(new Headers())).toBe("unknown");
  });
});
