import { describe, expect, it } from "vitest";
import { OTHER_OPTION_ID, type Question } from "@/lib/forms/schema";
import { buildAnswerSchema, validateAnswers } from "@/lib/forms/validation";
import { form, question, yesNo } from "./fixtures";

function check(q: Question, value: unknown) {
  const def = form(q);
  return validateAnswers(def, { [q.key]: value as never });
}
const errorOf = (q: Question, value: unknown) => {
  const r = check(q, value);
  return r.ok ? null : r.errors[q.key];
};
const req = (q: Question): Question => ({ ...q, required: true });

describe("buildAnswerSchema", () => {
  it("only includes visible keys and strips the rest", () => {
    const def = form(
      question({ key: "a", type: "short_text" }),
      question({ key: "b", type: "short_text" }),
    );
    const parsed = buildAnswerSchema(def, ["a"]).parse({
      a: "x",
      b: "hidden",
      evil: 1,
    });
    expect(parsed).toEqual({ a: "x" });
  });

  it("treats blank optional answers as missing", () => {
    const def = form(question({ key: "a", type: "short_text" }));
    expect(buildAnswerSchema(def, ["a"]).parse({ a: "   " })).toEqual({});
  });
});

describe("required", () => {
  it.each([
    question({ key: "a", type: "short_text" }),
    question({ key: "a", type: "number" }),
    question({ key: "a", type: "checkboxes", options: yesNo }),
  ])("rejects missing answers for $type", (q) => {
    expect(errorOf(req(q), undefined)).toBe("required");
    expect(errorOf(req(q), "")).toBe("required");
  });
});

describe("short_text / paragraph", () => {
  const q = question({
    key: "a",
    type: "short_text",
    validation: { minLength: 3, maxLength: 5, pattern: "[a-z]+" },
  });
  it("enforces length and full-match pattern", () => {
    expect(errorOf(q, "abcd")).toBeNull();
    expect(errorOf(q, "ab")).toBe("tooShort");
    expect(errorOf(q, "abcdef")).toBe("tooLong");
    expect(errorOf(q, "abc1")).toBe("patternMismatch");
  });
  it("trims input", () => {
    const r = check(q, "  abc  ");
    expect(r.ok && r.data.a).toBe("abc");
  });
  it("caps paragraphs at 5000 chars", () => {
    expect(
      errorOf(question({ key: "a", type: "paragraph" }), "x".repeat(5001)),
    ).toBe("tooLong");
  });
  it("rejects non-strings", () => {
    expect(errorOf(question({ key: "a", type: "short_text" }), 5)).toBe(
      "invalid",
    );
  });
});

describe("email", () => {
  const q = question({ key: "a", type: "email" });
  it("validates email format", () => {
    expect(errorOf(q, "a@b.co")).toBeNull();
    expect(errorOf(q, "nope")).toBe("invalidEmail");
  });
});

describe("phone", () => {
  const q = question({ key: "a", type: "phone" });
  it.each(["+62 812-3456-7890", "(021) 555 1234"])("accepts %s", (v) =>
    expect(errorOf(q, v)).toBeNull(),
  );
  it.each(["12345", "abc12345678", "+1 234 567 890 123 456 78"])(
    "rejects %s",
    (v) => expect(errorOf(q, v)).toBe("invalidPhone"),
  );
});

describe("number", () => {
  const q = question({
    key: "a",
    type: "number",
    validation: { min: 1, max: 10, integerOnly: true },
  });
  it("enforces bounds and integers", () => {
    expect(errorOf(q, 5)).toBeNull();
    expect(errorOf(q, 0)).toBe("tooSmall");
    expect(errorOf(q, 11)).toBe("tooLarge");
    expect(errorOf(q, 2.5)).toBe("notInteger");
    expect(errorOf(q, "abc")).toBe("invalid");
  });
  it("coerces numeric strings", () => {
    const r = check(q, "7");
    expect(r.ok && r.data.a).toBe(7);
  });
});

describe("date", () => {
  const q = question({
    key: "a",
    type: "date",
    validation: { minDate: "2026-01-01", maxDate: "2026-12-31" },
  });
  it("validates calendar dates and bounds", () => {
    expect(errorOf(q, "2026-06-15")).toBeNull();
    expect(errorOf(q, "2026-02-30")).toBe("invalidDate");
    expect(errorOf(q, "15/06/2026")).toBe("invalidDate");
    expect(errorOf(q, "2025-12-31")).toBe("dateTooEarly");
    expect(errorOf(q, "2027-01-01")).toBe("dateTooLate");
  });
});

describe("rating / linear_scale", () => {
  it("rating accepts 1..max", () => {
    const q = question({ key: "a", type: "rating", rating: { max: 5 } });
    expect(errorOf(q, 5)).toBeNull();
    expect(errorOf(q, 0)).toBe("tooSmall");
    expect(errorOf(q, 6)).toBe("tooLarge");
    expect(errorOf(q, 2.5)).toBe("invalid");
  });
  it("linear_scale accepts min..max", () => {
    const q = question({
      key: "a",
      type: "linear_scale",
      scale: { min: 0, max: 10 },
    });
    expect(errorOf(q, 0)).toBeNull();
    expect(errorOf(q, 10)).toBeNull();
    expect(errorOf(q, 11)).toBe("tooLarge");
  });
});

describe("multiple_choice / dropdown", () => {
  for (const type of ["multiple_choice", "dropdown"] as const) {
    const q = question({ key: "a", type, options: yesNo, allowOther: true });
    it(`${type}: exactly one known option`, () => {
      expect(errorOf(q, { selected: ["yes"] })).toBeNull();
      expect(errorOf(q, { selected: ["yes", "no"] })).toBe("invalid");
      expect(errorOf(q, { selected: ["maybe"] })).toBe("invalidOption");
      expect(errorOf(q, "yes")).toBe("invalid");
    });
    it(`${type}: "Other" needs text`, () => {
      expect(errorOf(q, { selected: [OTHER_OPTION_ID] })).toBe("otherRequired");
      const r = check(q, {
        selected: [OTHER_OPTION_ID],
        otherText: "  custom ",
      });
      expect(r.ok && r.data.a).toEqual({
        selected: [OTHER_OPTION_ID],
        otherText: "custom",
      });
    });
  }

  it("rejects Other when not allowed and drops stray otherText", () => {
    const q = question({ key: "a", type: "multiple_choice", options: yesNo });
    expect(errorOf(q, { selected: [OTHER_OPTION_ID], otherText: "x" })).toBe(
      "invalidOption",
    );
    const r = check(q, { selected: ["yes"], otherText: "ignored" });
    expect(r.ok && r.data.a).toEqual({ selected: ["yes"] });
  });
});

describe("checkboxes", () => {
  const q = question({
    key: "a",
    type: "checkboxes",
    options: [...yesNo, { id: "maybe", label: "Maybe" }],
    validation: { min: 2, max: 2 },
  });
  it("enforces selection count and uniqueness", () => {
    expect(errorOf(q, { selected: ["yes", "no"] })).toBeNull();
    expect(errorOf(q, { selected: ["yes"] })).toBe("tooFewSelections");
    expect(errorOf(q, { selected: ["yes", "no", "maybe"] })).toBe(
      "tooManySelections",
    );
    expect(errorOf(q, { selected: ["yes", "yes"] })).toBe("invalidOption");
  });
});

describe("validateAnswers with logic", () => {
  const def = form(
    question({
      key: "a",
      type: "multiple_choice",
      options: yesNo,
      required: true,
    }),
    question({
      key: "b",
      type: "short_text",
      required: true,
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "a", operator: "equals", value: "yes" }],
      },
    }),
  );

  it("does not require hidden questions and strips their answers", () => {
    const r = validateAnswers(def, { a: { selected: ["no"] }, b: "stale" });
    expect(r).toEqual({ ok: true, data: { a: { selected: ["no"] } } });
  });

  it("requires visible required questions", () => {
    expect(validateAnswers(def, { a: { selected: ["yes"] } })).toEqual({
      ok: false,
      errors: { b: "required" },
    });
  });

  it("can validate a subset (one page)", () => {
    expect(
      validateAnswers(def, { a: { selected: ["yes"] } }, ["a"]),
    ).toMatchObject({ ok: true });
  });
});
