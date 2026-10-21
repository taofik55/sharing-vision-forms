import { describe, expect, it } from "vitest";
import { analysisQuestions } from "@/lib/forms/analysis";
import {
  computeFlow,
  displayOptions,
  displayRows,
  effectiveOptions,
  effectiveRows,
  logicContext,
  matchOption,
  pipeText,
  type Answers,
} from "@/lib/forms/logic";
import {
  validateDefinition,
  type FormDefinition,
  type Question,
} from "@/lib/forms/schema";
import { toAnswerRows } from "@/lib/forms/submission";
import { validateAnswers } from "@/lib/forms/validation";
import { question } from "./fixtures";

const banksS5 = [
  { id: "s5bri", label: "BRI", code: "1" },
  { id: "s5bca", label: "BCA", code: "2" },
  { id: "s5dig", label: "Bank digital", code: "7" },
  { id: "s5none", label: "Tidak punya rekening usaha", code: "9" },
];
const banksB = [
  { id: "bbri", label: "BRI", code: "1" },
  { id: "bbca", label: "BCA", code: "2" },
  { id: "bjago", label: "Bank Jago", code: "7" },
  { id: "bnone", label: "Tidak ada", code: "0", exclusive: true },
];
const yesNo = [
  { id: "y", label: "Ya", code: "1" },
  { id: "n", label: "Tidak", code: "2" },
];

function survey(): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [
      {
        id: "secS",
        title: "Screening",
        questions: [
          question({
            key: "s1",
            code: "S1",
            type: "multiple_choice",
            required: true,
            options: [
              { id: "own", label: "Pemilik", code: "1" },
              { id: "emp", label: "Karyawan", code: "3" },
            ],
            rules: [
              {
                action: "terminate",
                reason: "Bukan pengambil keputusan",
                when: {
                  combinator: "or",
                  conditions: [
                    { questionKey: "s1", operator: "equals", value: "emp" },
                  ],
                },
              },
            ],
          }),
          question({
            key: "s4",
            code: "S4",
            type: "number",
            required: true,
            rules: [
              {
                action: "terminate",
                when: {
                  combinator: "or",
                  conditions: [
                    { questionKey: "s4", operator: "lt", value: 21 },
                    { questionKey: "s4", operator: "gt", value: 55 },
                  ],
                },
              },
            ],
          }),
          question({
            key: "s5",
            code: "S5",
            type: "multiple_choice",
            required: true,
            options: banksS5,
          }),
        ],
      },
      {
        id: "secB",
        title: "Banking",
        questions: [
          question({
            key: "b1",
            code: "B1",
            type: "checkboxes",
            required: true,
            options: banksB,
            autoSelectFrom: "s5",
          }),
          question({
            key: "b2",
            code: "B2",
            title: "Dipakai untuk apa di [B1]?",
            type: "grid",
            required: true,
            options: [
              { id: "pay", label: "Menerima pembayaran", code: "1" },
              { id: "save", label: "Menabung", code: "2" },
              {
                id: "rare",
                label: "Jarang dipakai",
                code: "7",
                exclusive: true,
              },
            ],
            grid: { rows: [], multiple: true, rowsFrom: "b1" },
          }),
          question({
            key: "b4",
            code: "B4",
            title: "Alasan memilih [S5]",
            type: "ranking",
            required: true,
            ranking: { max: 2 },
            options: [
              { id: "near", label: "Dekat", code: "1" },
              { id: "cheap", label: "Murah", code: "3" },
              { id: "app", label: "Aplikasi", code: "4" },
            ],
            rules: [{ action: "jump", target: "secG" }],
          }),
          question({
            key: "b5",
            code: "B5",
            type: "multiple_choice",
            options: yesNo,
          }),
        ],
      },
      {
        id: "secG",
        title: "Satisfaction",
        questions: [
          question({
            key: "g1",
            code: "G1",
            type: "grid",
            required: true,
            options: [
              { id: "1", label: "1", code: "1" },
              { id: "5", label: "5", code: "5" },
              { id: "97", label: "Tidak pernah pakai", code: "97" },
            ],
            grid: {
              multiple: false,
              randomizeRows: true,
              rows: [
                { id: "a", label: "Biaya", code: "1" },
                { id: "b", label: "Aplikasi", code: "2" },
                { id: "c", label: "Cabang", code: "3" },
              ],
              maxPerColumn: [{ optionId: "97", max: 1 }],
            },
          }),
          question({
            key: "g2",
            code: "G2",
            type: "grid",
            required: true,
            orderLike: "g1",
            options: [
              { id: "1", label: "1" },
              { id: "5", label: "5" },
            ],
            grid: {
              multiple: false,
              randomizeRows: true,
              rows: [
                { id: "a", label: "Biaya" },
                { id: "b", label: "Aplikasi" },
                { id: "c", label: "Cabang" },
              ],
            },
          }),
          question({
            key: "d1a",
            code: "D1A",
            type: "multiple_choice",
            options: banksB,
            notSameAs: "s5",
          }),
          question({
            key: "c3b",
            code: "C3B",
            type: "multiple_choice",
            options: banksB,
            optionsFrom: { questionKey: "b1", mode: "selected" },
          }),
        ],
      },
    ],
  };
}

const keys = (def: FormDefinition, answers: Answers) =>
  computeFlow(def, answers).visible.map((q) => q.key);

describe("definition checks for the CAPI features", () => {
  it("the sample survey is publishable", () => {
    expect(validateDefinition(survey())).toEqual([]);
  });

  it("rejects backward jumps, unknown targets and unconditional screen-outs", () => {
    const def = survey();
    const b4 = def.sections[1].questions[2];
    b4.rules = [{ action: "jump", target: "s1" }];
    expect(validateDefinition(def).map((p) => p.code)).toContain(
      "ruleBackwardJump",
    );
    b4.rules = [{ action: "jump", target: "nope" }];
    expect(validateDefinition(def).map((p) => p.code)).toContain(
      "ruleUnknownTarget",
    );
    b4.rules = [{ action: "terminate" }];
    expect(validateDefinition(def).map((p) => p.code)).toContain(
      "ruleTerminateWithoutCondition",
    );
  });

  it("rejects references to later questions and duplicate codes", () => {
    const def = survey();
    def.sections[1].questions[0].autoSelectFrom = "g1";
    def.sections[2].questions[0].code = "S1";
    const codes = validateDefinition(def).map((p) => p.code);
    expect(codes).toContain("invalidReference");
    expect(codes).toContain("duplicateCode");
  });
});

describe("flow: screen-outs and jumps", () => {
  it("terminates on a screening answer with the question code", () => {
    const flow = computeFlow(survey(), { s1: { selected: ["emp"] } });
    expect(flow.terminated).toEqual({
      questionKey: "s1",
      code: "S1",
      reason: "Bukan pengambil keputusan",
    });
    expect(flow.visible.map((q) => q.key)).toEqual(["s1"]);
  });

  it("terminates on an age outside 21–55", () => {
    const base: Answers = { s1: { selected: ["own"] } };
    expect(computeFlow(survey(), { ...base, s4: 18 }).terminated?.code).toBe(
      "S4",
    );
    expect(computeFlow(survey(), { ...base, s4: 40 }).terminated).toBe(
      undefined,
    );
  });

  it("an unconditional jump skips to the target section", () => {
    const answers: Answers = {
      s1: { selected: ["own"] },
      s4: 40,
      s5: { selected: ["s5bri"] },
    };
    const visible = keys(survey(), answers);
    expect(visible).toContain("b4");
    expect(visible).not.toContain("b5");
    expect(visible).toContain("g1");
  });
});

describe("carry-forward, auto-select, not-same-as", () => {
  const answers: Answers = {
    s1: { selected: ["own"] },
    s4: 40,
    s5: { selected: ["s5bri"] },
    b1: { selected: ["bbri", "bjago"] },
  };

  it("matches options by label first, then by code", () => {
    expect(matchOption(banksS5[0], banksB)?.id).toBe("bbri");
    // "Bank digital" has no label twin: falls back to code 7.
    expect(matchOption(banksS5[2], banksB)?.id).toBe("bjago");
  });

  it("grid rows and choice options follow earlier answers", () => {
    const def = survey();
    const ctx = logicContext(def, answers);
    const b2 = def.sections[1].questions[1];
    expect(effectiveRows(b2, ctx).map((r) => r.id)).toEqual(["bbri", "bjago"]);
    const c3b = def.sections[2].questions[3];
    expect(effectiveOptions(c3b, ctx).map((o) => o.id)).toEqual([
      "bbri",
      "bjago",
    ]);
  });

  it("validates locked options, exclusive options and not-same-as", () => {
    const def = survey();
    const flowAnswers: Answers = {
      ...answers,
      b1: { selected: ["bbca"] },
    };
    const locked = validateAnswers(def, flowAnswers, ["b1"]);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.errors.b1).toBe("lockedOption");

    const exclusive = validateAnswers(
      def,
      { ...answers, b1: { selected: ["bbri", "bnone"] } },
      ["b1"],
    );
    expect(exclusive.ok).toBe(false);
    if (!exclusive.ok) expect(exclusive.errors.b1).toBe("exclusiveOption");

    const same = validateAnswers(
      def,
      { ...answers, d1a: { selected: ["bbri"] } },
      ["d1a"],
    );
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.d1a).toBe("sameAsOther");
  });
});

describe("grid and ranking answers", () => {
  const base: Answers = {
    s1: { selected: ["own"] },
    s4: 40,
    s5: { selected: ["s5bri"] },
    b1: { selected: ["bbri"] },
  };

  it("needs every row of a required grid and caps a column", () => {
    const def = survey();
    const partial = validateAnswers(
      def,
      { ...base, g1: { rows: { a: ["1"] } } },
      ["g1"],
    );
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors.g1).toBe("rowsRequired");

    const capped = validateAnswers(
      def,
      { ...base, g1: { rows: { a: ["97"], b: ["97"], c: ["5"] } } },
      ["g1"],
    );
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.errors.g1).toBe("tooManyInColumn");
  });

  it("caps a ranking at its maximum", () => {
    const def = survey();
    const result = validateAnswers(
      def,
      { ...base, b4: { selected: ["near", "cheap", "app"] } },
      ["b4"],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.b4).toBe("tooManySelections");
  });

  it("stores grid rows and ranking positions as analysis keys", () => {
    const def = survey();
    const rows = toAnswerRows(def, {
      b2: { rows: { bbri: ["pay", "save"] } },
      b4: { selected: ["cheap", "near"] },
      g1: { rows: { a: ["1"], b: ["5"], c: ["97"] } },
    });
    expect(
      rows.map((r) => [r.question_key, r.question_type, r.value_options]),
    ).toEqual([
      ["b2__bbri", "checkboxes", ["pay", "save"]],
      ["b4", "checkboxes", ["cheap", "near"]],
      ["b4__r1", "multiple_choice", ["cheap"]],
      ["b4__r2", "multiple_choice", ["near"]],
      ["g1__a", "multiple_choice", ["1"]],
      ["g1__b", "multiple_choice", ["5"]],
      ["g1__c", "multiple_choice", ["97"]],
    ]);
    const analysis = analysisQuestions(def).map((q) => q.key);
    for (const key of rows.map((r) => r.question_key))
      expect(analysis).toContain(key);
  });
});

describe("piping and seeded order", () => {
  it("replaces [CODE] with the answer and keeps unknown tokens", () => {
    const def = survey();
    expect(
      pipeText("Alasan memilih [S5] [kartu skala]", def, {
        s5: { selected: ["s5bca"] },
      }),
    ).toBe("Alasan memilih BCA [kartu skala]");
    expect(pipeText("Bank [S5]", def, {})).toBe("Bank [S5]");
  });

  it("orders rows the same way for questions that share an order", () => {
    const def = survey();
    const [g1, g2] = def.sections[2].questions as Question[];
    const seed = "interview-42";
    const order1 = displayRows(g1, g1.grid!.rows, seed).map((r) => r.id);
    const order2 = displayRows(g2, g2.grid!.rows, seed).map((r) => r.id);
    expect(order2).toEqual(order1);
    expect([...order1].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps anchored options (exclusive, 97+) at the end", () => {
    const q = question({
      key: "q",
      type: "checkboxes",
      randomizeOptions: true,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "x", label: "Lainnya", code: "99" },
        { id: "none", label: "Tidak ada", exclusive: true },
      ],
    });
    for (const seed of ["1", "2", "3", "4"]) {
      const order = displayOptions(q, q.options!, seed).map((o) => o.id);
      expect(order.slice(-2)).toEqual(["x", "none"]);
    }
  });
});
