import { describe, expect, it } from "vitest";
import {
  formDefinitionSchema,
  operatorsForType,
  parseAndValidateDefinition,
  validateDefinition,
  QUESTION_TYPES,
  type FormDefinition,
} from "@/lib/forms/schema";
import { form, question, twoSectionForm, yesNo } from "./fixtures";

const codes = (def: FormDefinition) =>
  validateDefinition(def).map((p) => p.code);

describe("formDefinitionSchema (structure)", () => {
  it("accepts a minimal definition", () => {
    expect(
      formDefinitionSchema.safeParse(
        form(question({ key: "a", type: "short_text" })),
      ).success,
    ).toBe(true);
  });

  it.each([
    ["wrong schemaVersion", { schemaVersion: 2, sections: [] }],
    ["no sections", { schemaVersion: 1, sections: [] }],
    ["unknown type", form(question({ key: "a", type: "slider" as never }))],
    [
      "unknown property",
      form({
        ...question({ key: "a", type: "short_text" }),
        extra: 1,
      } as never),
    ],
    ["bad key chars", form(question({ key: "a b", type: "short_text" }))],
    [
      "scale out of range",
      form(
        question({
          key: "a",
          type: "linear_scale",
          scale: { min: 1, max: 11 },
        }),
      ),
    ],
    [
      "rating out of range",
      form(question({ key: "a", type: "rating", rating: { max: 2 } })),
    ],
  ])("rejects %s", (_, value) => {
    expect(formDefinitionSchema.safeParse(value).success).toBe(false);
  });
});

describe("validateDefinition", () => {
  it("passes a valid form", () => {
    expect(
      codes(
        form(
          question({ key: "a", type: "multiple_choice", options: yesNo }),
          question({
            key: "b",
            type: "short_text",
            showIf: {
              combinator: "and",
              conditions: [
                { questionKey: "a", operator: "equals", value: "yes" },
              ],
            },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("requires at least one question", () => {
    expect(
      codes({
        schemaVersion: 1,
        sections: [{ id: "s1", title: "S", questions: [] }],
      }),
    ).toEqual(["noQuestions"]);
  });

  it("detects duplicate keys and ids", () => {
    const a = question({ key: "a", type: "short_text" });
    expect(codes(form(a, { ...a, id: "other" }))).toContain("duplicateKey");
    expect(codes(form(a, { ...a, key: "other" }))).toContain("duplicateId");
  });

  it("rejects a section id reused as a question id", () => {
    const def = form(question({ key: "a", type: "short_text", id: "s1" }));
    expect(codes(def)).toContain("duplicateId");
  });

  it("rejects empty titles", () => {
    expect(
      codes(form(question({ key: "a", type: "short_text", title: "  " }))),
    ).toContain("emptyQuestionTitle");
    const def = form(question({ key: "a", type: "short_text" }));
    def.sections[0].title = "";
    expect(codes(def)).toContain("emptySectionTitle");
  });

  it("requires two non-empty, unique options for choice types", () => {
    for (const type of ["multiple_choice", "checkboxes", "dropdown"] as const) {
      expect(
        codes(form(question({ key: "a", type, options: [yesNo[0]] }))),
      ).toContain("tooFewOptions");
      expect(codes(form(question({ key: "a", type })))).toContain(
        "tooFewOptions",
      );
    }
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "dropdown",
            options: [yesNo[0], { id: "x", label: " " }],
          }),
        ),
      ),
    ).toContain("emptyOptionLabel");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "dropdown",
            options: [yesNo[0], yesNo[0]],
          }),
        ),
      ),
    ).toContain("duplicateOptionId");
  });

  it("checks validation ranges and patterns", () => {
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "short_text",
            validation: { pattern: "(" },
          }),
        ),
      ),
    ).toContain("invalidPattern");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "short_text",
            validation: { minLength: 5, maxLength: 2 },
          }),
        ),
      ),
    ).toContain("invalidLengthRange");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "number",
            validation: { min: 5, max: 2 },
          }),
        ),
      ),
    ).toContain("invalidNumberRange");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "checkboxes",
            options: yesNo,
            validation: { min: 2, max: 1 },
          }),
        ),
      ),
    ).toContain("invalidSelectionRange");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "date",
            validation: { minDate: "2026-02-30" },
          }),
        ),
      ),
    ).toContain("invalidDateRange");
    expect(
      codes(
        form(
          question({
            key: "a",
            type: "date",
            validation: { minDate: "2026-05-01", maxDate: "2026-01-01" },
          }),
        ),
      ),
    ).toContain("invalidDateRange");
  });

  it("requires scale and rating settings", () => {
    expect(codes(form(question({ key: "a", type: "linear_scale" })))).toContain(
      "missingScale",
    );
    expect(codes(form(question({ key: "a", type: "rating" })))).toContain(
      "missingRating",
    );
  });

  describe("conditions", () => {
    const choice = question({
      key: "a",
      type: "multiple_choice",
      options: yesNo,
    });
    const withCondition = (
      condition: object,
      combinatorConditions?: object[],
    ) =>
      question({
        key: "b",
        type: "short_text",
        showIf: {
          combinator: "and",
          conditions: (combinatorConditions ?? [condition]) as never,
        },
      });

    it("rejects an empty condition group", () => {
      expect(codes(form(choice, withCondition({}, [])))).toContain(
        "conditionEmpty",
      );
    });

    it("rejects unknown and forward references (including self)", () => {
      expect(
        codes(
          form(
            choice,
            withCondition({ questionKey: "zzz", operator: "is_answered" }),
          ),
        ),
      ).toContain("conditionUnknownQuestion");
      const forward = form(
        question({
          key: "b",
          type: "short_text",
          showIf: {
            combinator: "and",
            conditions: [{ questionKey: "a", operator: "is_answered" }],
          },
        }),
        choice,
      );
      expect(codes(forward)).toContain("conditionForwardReference");
      const self = form(
        question({
          key: "a",
          type: "short_text",
          showIf: {
            combinator: "and",
            conditions: [{ questionKey: "a", operator: "is_answered" }],
          },
        }),
      );
      expect(codes(self)).toContain("conditionForwardReference");
    });

    it("allows references to earlier sections", () => {
      const def = twoSectionForm(
        [choice],
        [
          question({
            key: "b",
            type: "short_text",
            showIf: {
              combinator: "or",
              conditions: [{ questionKey: "a", operator: "is_empty" }],
            },
          }),
        ],
      );
      expect(codes(def)).toEqual([]);
    });

    it("rejects operators that do not fit the referenced type", () => {
      expect(
        codes(
          form(
            choice,
            withCondition({ questionKey: "a", operator: "gt", value: 1 }),
          ),
        ),
      ).toContain("conditionInvalidOperator");
    });

    it("requires a valid value", () => {
      expect(
        codes(
          form(choice, withCondition({ questionKey: "a", operator: "equals" })),
        ),
      ).toContain("conditionMissingValue");
      expect(
        codes(
          form(
            choice,
            withCondition({
              questionKey: "a",
              operator: "equals",
              value: "maybe",
            }),
          ),
        ),
      ).toContain("conditionInvalidValue");
      const num = question({ key: "a", type: "number" });
      expect(
        codes(
          form(
            num,
            withCondition({ questionKey: "a", operator: "gt", value: "5" }),
          ),
        ),
      ).toContain("conditionInvalidValue");
      expect(
        codes(
          form(
            num,
            withCondition({ questionKey: "a", operator: "gt", value: 5 }),
          ),
        ),
      ).toEqual([]);
    });
  });
});

describe("parseAndValidateDefinition", () => {
  it("reports invalid structure", () => {
    expect(parseAndValidateDefinition({ nope: true })).toEqual({
      ok: false,
      problems: [{ code: "invalidStructure" }],
    });
  });
});

describe("operatorsForType", () => {
  it("covers every question type with is_answered / is_empty", () => {
    for (const type of QUESTION_TYPES) {
      expect(operatorsForType(type)).toEqual(
        expect.arrayContaining(["is_answered", "is_empty"]),
      );
    }
  });
});
