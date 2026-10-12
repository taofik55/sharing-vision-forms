import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  evaluateConditionGroup,
  getVisibleKeys,
  getVisibleSections,
  isAnswerEmpty,
  type AnswerValue,
  type Answers,
} from "@/lib/forms/logic";
import type { Condition, Question } from "@/lib/forms/schema";
import { form, question, twoSectionForm, yesNo } from "./fixtures";

const questions: Question[] = [
  question({ key: "text", type: "short_text" }),
  question({ key: "num", type: "number" }),
  question({ key: "rate", type: "rating", rating: { max: 5 } }),
  question({ key: "date", type: "date" }),
  question({ key: "single", type: "multiple_choice", options: yesNo }),
  question({
    key: "multi",
    type: "checkboxes",
    options: [...yesNo, { id: "maybe", label: "Maybe" }],
  }),
];
const byKey = new Map(questions.map((q) => [q.key, q]));
const evalOne = (condition: Condition, answers: Answers) =>
  evaluateCondition(condition, answers, byKey);

describe("isAnswerEmpty", () => {
  it.each([undefined, null, "", "   ", Number.NaN, { selected: [] }, []])(
    "%j is empty",
    (v) => {
      expect(isAnswerEmpty(v)).toBe(true);
    },
  );
  it.each(["x", 0, { selected: ["a"] }])("%j is not empty", (v) => {
    expect(isAnswerEmpty(v)).toBe(false);
  });
});

describe("evaluateCondition", () => {
  describe("is_answered / is_empty", () => {
    it("works for every kind of answer", () => {
      const cases: [string, AnswerValue][] = [
        ["text", "hi"],
        ["num", 0],
        ["date", "2026-01-01"],
        ["single", { selected: ["yes"] }],
      ];
      for (const [key, value] of cases) {
        expect(
          evalOne(
            { questionKey: key, operator: "is_answered" },
            { [key]: value },
          ),
        ).toBe(true);
        expect(
          evalOne({ questionKey: key, operator: "is_empty" }, { [key]: value }),
        ).toBe(false);
        expect(evalOne({ questionKey: key, operator: "is_answered" }, {})).toBe(
          false,
        );
        expect(evalOne({ questionKey: key, operator: "is_empty" }, {})).toBe(
          true,
        );
      }
    });
  });

  describe("equals / not_equals", () => {
    it("compares text case-insensitively and trimmed", () => {
      expect(
        evalOne(
          { questionKey: "text", operator: "equals", value: "Hello" },
          { text: " hello " },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "text", operator: "not_equals", value: "Hello" },
          { text: "bye" },
        ),
      ).toBe(true);
    });
    it("compares numbers numerically", () => {
      expect(
        evalOne(
          { questionKey: "num", operator: "equals", value: 5 },
          { num: 5 },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "num", operator: "equals", value: 5 },
          { num: "5" as never },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "num", operator: "not_equals", value: 5 },
          { num: 6 },
        ),
      ).toBe(true);
    });
    it("matches single choice by option id", () => {
      expect(
        evalOne(
          { questionKey: "single", operator: "equals", value: "yes" },
          { single: { selected: ["yes"] } },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "single", operator: "equals", value: "no" },
          { single: { selected: ["yes"] } },
        ),
      ).toBe(false);
      expect(
        evalOne(
          { questionKey: "single", operator: "not_equals", value: "no" },
          { single: { selected: ["yes"] } },
        ),
      ).toBe(true);
    });
    it("treats an empty answer as not equal", () => {
      expect(
        evalOne({ questionKey: "text", operator: "equals", value: "x" }, {}),
      ).toBe(false);
      expect(
        evalOne(
          { questionKey: "text", operator: "not_equals", value: "x" },
          {},
        ),
      ).toBe(true);
    });
    it("matches dates exactly", () => {
      expect(
        evalOne(
          { questionKey: "date", operator: "equals", value: "2026-03-01" },
          { date: "2026-03-01" },
        ),
      ).toBe(true);
    });
  });

  describe("contains", () => {
    it("checks substrings for text", () => {
      expect(
        evalOne(
          { questionKey: "text", operator: "contains", value: "WORLD" },
          { text: "hello world" },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "text", operator: "contains", value: "x" },
          { text: "hello" },
        ),
      ).toBe(false);
      expect(
        evalOne({ questionKey: "text", operator: "contains", value: "x" }, {}),
      ).toBe(false);
    });
    it("checks selection for checkboxes", () => {
      const answers = { multi: { selected: ["yes", "maybe"] } };
      expect(
        evalOne(
          { questionKey: "multi", operator: "contains", value: "maybe" },
          answers,
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "multi", operator: "contains", value: "no" },
          answers,
        ),
      ).toBe(false);
    });
  });

  describe("gt / lt", () => {
    it("compares numbers and ratings", () => {
      expect(
        evalOne({ questionKey: "num", operator: "gt", value: 3 }, { num: 4 }),
      ).toBe(true);
      expect(
        evalOne({ questionKey: "num", operator: "gt", value: 4 }, { num: 4 }),
      ).toBe(false);
      expect(
        evalOne({ questionKey: "rate", operator: "lt", value: 3 }, { rate: 2 }),
      ).toBe(true);
      expect(
        evalOne({ questionKey: "rate", operator: "lt", value: 3 }, {}),
      ).toBe(false);
    });
    it("compares dates chronologically", () => {
      expect(
        evalOne(
          { questionKey: "date", operator: "gt", value: "2026-01-31" },
          { date: "2026-02-01" },
        ),
      ).toBe(true);
      expect(
        evalOne(
          { questionKey: "date", operator: "lt", value: "2026-01-31" },
          { date: "2026-02-01" },
        ),
      ).toBe(false);
    });
  });

  it("is false for unknown questions", () => {
    expect(evalOne({ questionKey: "ghost", operator: "is_empty" }, {})).toBe(
      false,
    );
  });
});

describe("evaluateConditionGroup", () => {
  const yes = {
    questionKey: "single",
    operator: "equals",
    value: "yes",
  } as const;
  const big = { questionKey: "num", operator: "gt", value: 10 } as const;
  const answers = { single: { selected: ["yes"] }, num: 1 };

  it("AND requires every condition", () => {
    expect(
      evaluateConditionGroup(
        { combinator: "and", conditions: [yes, big] },
        answers,
        byKey,
      ),
    ).toBe(false);
    expect(
      evaluateConditionGroup(
        { combinator: "and", conditions: [yes] },
        answers,
        byKey,
      ),
    ).toBe(true);
  });
  it("OR requires any condition", () => {
    expect(
      evaluateConditionGroup(
        { combinator: "or", conditions: [yes, big] },
        answers,
        byKey,
      ),
    ).toBe(true);
    expect(
      evaluateConditionGroup(
        { combinator: "or", conditions: [big] },
        answers,
        byKey,
      ),
    ).toBe(false);
  });
  it("is true without conditions", () => {
    expect(evaluateConditionGroup(undefined, {}, byKey)).toBe(true);
    expect(
      evaluateConditionGroup({ combinator: "or", conditions: [] }, {}, byKey),
    ).toBe(true);
  });
});

describe("getVisibleQuestions", () => {
  // a -> b (if a = yes) -> c (if b answered) -> d (if c empty)
  const def = form(
    question({ key: "a", type: "multiple_choice", options: yesNo }),
    question({
      key: "b",
      type: "short_text",
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "a", operator: "equals", value: "yes" }],
      },
    }),
    question({
      key: "c",
      type: "short_text",
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "b", operator: "is_answered" }],
      },
    }),
    question({
      key: "d",
      type: "short_text",
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "c", operator: "is_empty" }],
      },
    }),
  );

  it("shows dependents when conditions match", () => {
    expect([
      ...getVisibleKeys(def, { a: { selected: ["yes"] }, b: "x", c: "y" }),
    ]).toEqual(["a", "b", "c"]);
  });

  it("collapses hidden chains: a hidden question's stale answer counts as empty", () => {
    // b and c still hold old answers, but a = no hides b, so c sees b as empty.
    const keys = getVisibleKeys(def, {
      a: { selected: ["no"] },
      b: "stale",
      c: "stale",
    });
    expect([...keys]).toEqual(["a", "d"]);
  });

  it("returns only sections with visible questions", () => {
    const two = twoSectionForm(
      [question({ key: "a", type: "multiple_choice", options: yesNo })],
      [
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
      ],
    );
    expect(
      getVisibleSections(two, { a: { selected: ["no"] } }).map((s) => s.id),
    ).toEqual(["s1"]);
    expect(
      getVisibleSections(two, { a: { selected: ["yes"] } }).map((s) => s.id),
    ).toEqual(["s1", "s2"]);
  });
});
