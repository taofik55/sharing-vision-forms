import { describe, expect, it } from "vitest";
import { analysisQuestions } from "@/lib/forms/analysis";
import {
  briKey as k,
  briUmkmCapiSettings,
  briUmkmDefinition,
  briUmkmSelfDefinition,
} from "@/lib/forms/bri-umkm";
import {
  allCells,
  capiSettingsProblems,
  quotaCell,
  remapCapiKeys,
} from "@/lib/forms/capi";
import { computeFlow, type Answers } from "@/lib/forms/logic";
import { cloneDefinitionWithNewKeys } from "@/lib/forms/operations";
import {
  flattenQuestions,
  formDefinitionSchema,
  validateDefinition,
} from "@/lib/forms/schema";

const def = briUmkmDefinition();
const pick = (code: string | number) => ({ selected: [`c${code}`] });

const qualified: Answers = {
  s1: pick(1),
  s2: pick(2),
  s3: pick(4),
  s4: 35,
  s5: pick(2),
  s6: pick(4),
  s7: { selected: ["c1", "c2"] },
  s8a: pick(2),
  s8b: pick(2),
  s9: pick(2),
  s10: pick(2),
};

describe("BRI UMKM questionnaire", () => {
  it("is a valid, publishable definition", () => {
    expect(formDefinitionSchema.safeParse(def).success).toBe(true);
    expect(validateDefinition(def)).toEqual([]);
  });

  it("has the interview settings it needs", () => {
    const settings = briUmkmCapiSettings();
    expect(capiSettingsProblems(settings, def)).toEqual([]);
    expect(allCells(settings)).toHaveLength(20);
    expect(quotaCell(settings, qualified)).toBe("SBY-F-N");
  });

  it("keeps interview settings valid on a duplicated form (new keys)", () => {
    const copy = cloneDefinitionWithNewKeys(def);
    const settings = remapCapiKeys(briUmkmCapiSettings(), def, copy);
    expect(capiSettingsProblems(settings, copy)).toEqual([]);
    const byCode = new Map(
      flattenQuestions(copy).map((q) => [q.code?.toLowerCase(), q.key]),
    );
    expect(settings.quota.checkAfter).toBe(byCode.get("s10"));
    const answers = Object.fromEntries(
      Object.entries(qualified).map(([key, value]) => [byCode.get(key), value]),
    );
    expect(quotaCell(settings, answers)).toBe("SBY-F-N");
  });

  it.each([
    [{ s1: pick(3) }, "S1"],
    [{ s2: pick(4) }, "S2"],
    [{ s3: pick(1) }, "S3"],
    [{ s4: 60 }, "S4"],
    [{ s5: pick(9) }, "S5"],
    [{ s6: pick(2) }, "S6"],
    [{ s7: pick(5) }, "S7"],
    [{ s8a: pick(1) }, "S8a"],
    [{ s8b: pick(1) }, "S8b"],
    [{ s9: pick(1) }, "S9"],
  ])("screens out on %o at %s", (patch, code) => {
    const flow = computeFlow(def, { ...qualified, ...patch });
    expect(flow.terminated?.code).toBe(code);
  });

  it("routes segments and skips (non-QRIS → C9, no EDC → C11)", () => {
    const nonQris: Answers = {
      ...qualified,
      c1: { selected: ["c1", "c3"] },
      c9: pick(1),
    };
    const keys = computeFlow(def, nonQris).visible.map((q) => q.key);
    expect(keys).toContain(k("C3b"));
    expect(keys).not.toContain(k("C4"));
    expect(keys).toContain(k("C11"));
    expect(keys).not.toContain(k("C10A"));
    // Non-BRI segment: H3–H5, not H6–H8.
    expect(keys).toContain(k("H3"));
    expect(keys).not.toContain(k("H6"));

    const bri = computeFlow(def, { ...qualified, s5: pick(1) }).visible.map(
      (q) => q.key,
    );
    expect(bri).toContain(k("H6"));
    expect(bri).not.toContain(k("H4"));
  });

  it("flattens grids and rankings for analysis", () => {
    const keys = analysisQuestions(def).map((q) => q.key);
    expect(keys).toContain("g1__r14");
    expect(keys).toContain("g2__r1");
    expect(keys).toContain("b4__r3");
    expect(keys.every((key) => key.length <= 64)).toBe(true);
    expect(flattenQuestions(def).length).toBeGreaterThan(90);
  });

  it("has a self-administered version without interviewer parts", () => {
    const self = briUmkmSelfDefinition();
    expect(formDefinitionSchema.safeParse(self).success).toBe(true);
    expect(validateDefinition(self)).toEqual([]);
    const questions = flattenQuestions(self);
    const text = JSON.stringify(self);
    expect(text).not.toMatch(/surveyor|\[kartu|dibacakan|wawancara/i);
    expect(questions.some((q) => q.noteRequired)).toBe(false);
    expect(
      questions.some((q) => q.type === "location" || q.type === "photo"),
    ).toBe(false);
    // Same keys and logic: screening still ends the survey.
    expect(
      computeFlow(self, { ...qualified, s1: pick(3) }).terminated?.code,
    ).toBe("S1");
    const original = new Set(flattenQuestions(def).map((q) => q.key));
    expect(questions.every((q) => original.has(q.key))).toBe(true);
  });
});
