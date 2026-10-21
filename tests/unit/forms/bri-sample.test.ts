import { describe, expect, it } from "vitest";
import {
  profileFor,
  rng,
  sampleInterview,
  sampleScreenOut,
} from "../../../scripts/lib/bri-sample";
import { briUmkmCapiSettings, briUmkmDefinition } from "@/lib/forms/bri-umkm";
import { missingNotes, quotaCell } from "@/lib/forms/capi";
import { computeFlow } from "@/lib/forms/logic";
import { prepareAnswers } from "@/lib/forms/submission";

const def = briUmkmDefinition();
const settings = briUmkmCapiSettings();

describe("BRI sample interviews", () => {
  it("generates valid interviews that land in their quota cell", () => {
    const r = rng(42);
    for (let i = 0; i < 60; i++) {
      const cell = {
        city: 1 + (i % 5),
        sector: (1 + (i % 2)) as 1 | 2,
        bri: i % 4 < 2,
      };
      const profile = profileFor(r, cell);
      const sample = sampleInterview(r, def, profile);
      const flow = computeFlow(def, sample.answers);
      expect(flow.terminated).toBeUndefined();
      const prepared = prepareAnswers(def, sample.answers, {
        [`j4_foto`]: "00000000-0000-4000-8000-000000000000",
      });
      if (!prepared.ok) throw new Error(JSON.stringify(prepared.errors));
      expect(
        missingNotes(
          def,
          flow.visible.map((q) => q.key),
          sample.notes,
        ),
      ).toEqual([]);
      expect(quotaCell(settings, sample.answers)).toBe(
        `${profile.city.code}-${cell.sector === 1 ? "R" : "F"}-${cell.bri ? "B" : "N"}`,
      );
    }
  });

  it("generates screen-outs that terminate at the failing question", () => {
    const r = rng(7);
    for (let i = 0; i < 20; i++) {
      const profile = profileFor(r, { city: 1, sector: 1, bri: true });
      const sample = sampleScreenOut(r, profile);
      expect(computeFlow(def, sample.answers).terminated?.code).toBe(
        sample.code,
      );
    }
  });
});
