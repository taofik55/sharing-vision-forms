import { describe, expect, it } from "vitest";
import { hashDefinition, stableStringify } from "@/lib/forms/hash";
import {
  addSection,
  changeQuestionType,
  cloneDefinitionWithNewKeys,
  createQuestion,
  createSection,
  duplicateQuestion,
  findQuestion,
  moveQuestion,
  moveSection,
  optionsFromLines,
  removeSection,
  updateQuestion,
} from "@/lib/forms/operations";
import { validateDefinition } from "@/lib/forms/schema";
import {
  TEMPLATE_IDS,
  getTemplate,
  instantiateTemplate,
  type TemplateId,
} from "@/lib/forms/templates";
import { form, question, twoSectionForm, yesNo } from "./fixtures";

const labels = { title: "Untitled", option: (n: number) => `Option ${n}` };

describe("createQuestion", () => {
  it("gives choice questions two default options and scales defaults", () => {
    expect(
      createQuestion("dropdown", labels).options?.map((o) => o.label),
    ).toEqual(["Option 1", "Option 2"]);
    expect(createQuestion("linear_scale", labels).scale).toEqual({
      min: 1,
      max: 5,
    });
    expect(createQuestion("rating", labels).rating).toEqual({ max: 5 });
    const a = createQuestion("short_text", labels);
    const b = createQuestion("short_text", labels);
    expect(a.key).not.toBe(b.key);
    expect(a.id).not.toBe(a.key);
  });
});

describe("changeQuestionType", () => {
  const choice = question({
    key: "a",
    type: "checkboxes",
    options: yesNo,
    allowOther: true,
    validation: { min: 1 },
  });

  it("keeps options between choice types", () => {
    const { question: q, lostOptions } = changeQuestionType(
      choice,
      "dropdown",
      labels,
    );
    expect(lostOptions).toBe(false);
    expect(q.options).toEqual(yesNo);
    expect(q.key).toBe("a");
    expect(q.validation).toBeUndefined(); // min selections do not apply to dropdowns
  });

  it("warns when options would be lost", () => {
    const { question: q, lostOptions } = changeQuestionType(
      choice,
      "short_text",
      labels,
    );
    expect(lostOptions).toBe(true);
    expect(q.options).toBeUndefined();
    expect(q.allowOther).toBeUndefined();
  });

  it("keeps compatible validation and logic", () => {
    const text = question({
      key: "t",
      type: "short_text",
      required: true,
      validation: { maxLength: 10, pattern: "x" },
      showIf: {
        combinator: "and",
        conditions: [{ questionKey: "z", operator: "is_answered" }],
      },
    });
    const { question: q } = changeQuestionType(text, "paragraph", labels);
    expect(q.validation).toEqual({ maxLength: 10 });
    expect(q.required).toBe(true);
    expect(q.showIf).toEqual(text.showIf);
  });

  it("keeps the placeholder only where fields show one", () => {
    const text = question({
      key: "p",
      type: "short_text",
      placeholder: "Nama lengkap",
    });
    expect(changeQuestionType(text, "email", labels).question.placeholder).toBe(
      "Nama lengkap",
    );
    expect(
      changeQuestionType(text, "date", labels).question.placeholder,
    ).toBeUndefined();
    const dropdown = question({
      key: "d",
      type: "dropdown",
      options: yesNo,
      placeholder: "Pilih kota",
    });
    // Radio buttons have no placeholder; switching back starts from the default.
    expect(
      changeQuestionType(dropdown, "multiple_choice", labels).question
        .placeholder,
    ).toBeUndefined();
  });
});

describe("question and section operations", () => {
  const def = twoSectionForm(
    [
      question({ key: "a", type: "short_text" }),
      question({ key: "b", type: "short_text" }),
    ],
    [question({ key: "c", type: "short_text" })],
  );

  it("moves questions within and across sections", () => {
    const within = moveQuestion(def, "id_b", "s1", 0);
    expect(within.sections[0].questions.map((q) => q.key)).toEqual(["b", "a"]);
    const across = moveQuestion(def, "id_a", "s2", 1);
    expect(across.sections[0].questions.map((q) => q.key)).toEqual(["b"]);
    expect(across.sections[1].questions.map((q) => q.key)).toEqual(["c", "a"]);
  });

  it("duplicates with a new id and key right after the original", () => {
    const { definition, question: copy } = duplicateQuestion(def, "id_a");
    expect(copy!.key).not.toBe("a");
    expect(copy!.id).not.toBe("id_a");
    expect(definition.sections[0].questions.map((q) => q.title)).toEqual([
      "a",
      "a",
      "b",
    ]);
  });

  it("updates questions without touching the original object", () => {
    const next = updateQuestion(def, "id_a", {
      title: "New",
      description: undefined,
    });
    expect(findQuestion(next, "id_a")?.question.title).toBe("New");
    expect(findQuestion(def, "id_a")?.question.title).toBe("a");
    expect("description" in findQuestion(next, "id_a")!.question).toBe(false);
  });

  it("adds, moves and removes sections but never the last one", () => {
    const added = addSection(def, createSection("Three"));
    expect(added.sections.map((s) => s.title)).toEqual(["One", "Two", "Three"]);
    expect(moveSection(added, added.sections[2].id, 0).sections[0].title).toBe(
      "Three",
    );
    const single = form(question({ key: "a", type: "short_text" }));
    expect(removeSection(single, "s1")).toBe(single);
  });

  it("parses pasted options, skipping blanks and duplicates", () => {
    const options = optionsFromLines("Red\n\n Green \nred\r\nBlue", [
      { id: "x", label: "Blue" },
    ]);
    expect(options.map((o) => o.label)).toEqual(["Blue", "Red", "Green"]);
  });
});

describe("cloneDefinitionWithNewKeys", () => {
  it("assigns new keys and remaps condition references", () => {
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
    );
    const clone = cloneDefinitionWithNewKeys(def);
    const [a, b] = clone.sections[0].questions;
    expect(a.key).not.toBe("a");
    expect(b.showIf?.conditions[0].questionKey).toBe(a.key);
    expect(a.options).toEqual(yesNo);
    expect(clone.sections[0].id).not.toBe("s1");
    expect(validateDefinition(clone)).toEqual([]);
  });
});

describe("templates", () => {
  it.each(
    TEMPLATE_IDS.flatMap((id) =>
      (["en", "id"] as const).map((locale) => [id, locale] as const),
    ),
  )("%s (%s) is a valid definition", (id, locale) => {
    const { definition, title } = instantiateTemplate(id as TemplateId, locale);
    expect(title).toBeTruthy();
    expect(validateDefinition(definition)).toEqual([]);
  });

  it.each(TEMPLATE_IDS.filter((id) => id !== "blank"))(
    "%s mixes types and has a conditional rule",
    (id) => {
      const questions = getTemplate(id, "en").definition.sections.flatMap(
        (s) => s.questions,
      );
      expect(new Set(questions.map((q) => q.type)).size).toBeGreaterThanOrEqual(
        6,
      );
      expect(questions.some((q) => q.showIf)).toBe(true);
    },
  );

  it("en and id share the same structure and keys", () => {
    for (const id of TEMPLATE_IDS) {
      const keys = (l: "en" | "id") =>
        getTemplate(id, l).definition.sections.flatMap((s) =>
          s.questions.map((q) => `${q.key}:${q.type}`),
        );
      expect(keys("id")).toEqual(keys("en"));
    }
  });
});

describe("hashDefinition", () => {
  it("ignores key order and undefined values", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(
      '{"a":[1,{"d":2}],"b":1}',
    );
    expect(hashDefinition({ a: 1, b: 2 })).toBe(hashDefinition({ b: 2, a: 1 }));
    expect(hashDefinition({ a: 1 })).not.toBe(hashDefinition({ a: 2 }));
    expect(hashDefinition({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
