/**
 * Realistic sample interviews for the BRI UMKM questionnaire: answers follow
 * the form's own flow (show-if, jumps, carry-forward, exclusive options,
 * grid limits), the quota cell decides city / sector / segment, and BRI
 * customers answer a little more favourably about BRI. Deterministic for a
 * given seed. Used by scripts/seed-bri.ts and the unit tests.
 */
import { briKey as k } from "../../src/lib/forms/bri-umkm";
import type { Notes } from "../../src/lib/forms/capi";
import {
  answerDisplay,
  computeFlow,
  effectiveOptions,
  effectiveRows,
  lockedOptionIds,
  logicContext,
  matchOption,
  selectedOptions,
  type AnswerValue,
  type Answers,
} from "../../src/lib/forms/logic";
import type {
  FormDefinition,
  Option,
  Question,
} from "../../src/lib/forms/schema";
import { validateAnswers } from "../../src/lib/forms/validation";

export type Rng = () => number;

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = <T>(r: Rng, items: readonly T[]): T =>
  items[Math.floor(r() * items.length)];

function weighted<T>(
  r: Rng,
  items: readonly T[],
  weight: (item: T, i: number) => number,
): T {
  const weights = items.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i];
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

function shuffle<T>(r: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const code = (o: Option) => Number(o.code ?? 0);
/** "Don't know / refuse / other" are rare; earlier options a bit likelier. */
const optionWeight = (o: Option, i: number) =>
  code(o) >= 97 ? 0.15 : o.exclusive ? 0.6 : 1 / (1 + i * 0.08);

export const CITIES = [
  {
    option: 1,
    code: "JKT",
    name: "Jakarta",
    lat: -6.2,
    lng: 106.82,
    kec: [
      "Tanah Abang",
      "Kebayoran Baru",
      "Cempaka Putih",
      "Tebet",
      "Kelapa Gading",
    ],
  },
  {
    option: 2,
    code: "SBY",
    name: "Surabaya",
    lat: -7.26,
    lng: 112.75,
    kec: ["Genteng", "Wonokromo", "Rungkut", "Tegalsari", "Gubeng"],
  },
  {
    option: 3,
    code: "BDG",
    name: "Bandung",
    lat: -6.91,
    lng: 107.61,
    kec: ["Coblong", "Sukajadi", "Lengkong", "Cicendo", "Antapani"],
  },
  {
    option: 4,
    code: "SMG",
    name: "Semarang",
    lat: -6.99,
    lng: 110.42,
    kec: [
      "Semarang Tengah",
      "Candisari",
      "Banyumanik",
      "Tembalang",
      "Gajahmungkur",
    ],
  },
  {
    option: 5,
    code: "YGY",
    name: "Yogyakarta",
    lat: -7.8,
    lng: 110.37,
    kec: ["Gondokusuman", "Mergangsan", "Umbulharjo", "Jetis", "Gedongtengen"],
  },
] as const;

const STREETS = [
  "Jl. Merdeka",
  "Jl. Sudirman",
  "Jl. Pahlawan",
  "Jl. Diponegoro",
  "Jl. Pemuda",
  "Jl. Gajah Mada",
  "Jl. Ahmad Yani",
  "Jl. Veteran",
];

/** 1x1 JPEG placeholder for "photo taken" (sample data only). */
export const SAMPLE_PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export type Profile = {
  city: (typeof CITIES)[number];
  /** 1 = Retail, 2 = F&B (S2 option code). */
  sector: 1 | 2;
  /** S5 option code: 1 = BRI, else another bank. */
  bank: number;
  /** Overall attitude 0..1 (drives scales). */
  mood: number;
  straightline: boolean;
};

export function profileFor(
  r: Rng,
  cell: { city: number; sector: 1 | 2; bri: boolean },
): Profile {
  return {
    city: CITIES.find((c) => c.option === cell.city)!,
    sector: cell.sector,
    bank: cell.bri
      ? 1
      : weighted(
          r,
          [2, 3, 4, 5, 6, 7, 8, 99],
          (b) =>
            ({ 2: 5, 3: 4, 4: 3, 5: 1.5, 6: 1, 7: 1.5, 8: 0.6, 99: 0.2 })[b] ??
            1,
        ),
    mood: Math.min(
      1,
      Math.max(0, 0.55 + (cell.bri ? 0.12 : 0) + (r() - 0.5) * 0.6),
    ),
    straightline: r() < 0.05,
  };
}

const pick = (c: number | string) => ({ selected: [`c${c}`] });

/** Screening answers that qualify for the given profile. */
export function screeningAnswers(r: Rng, p: Profile): Answers {
  return {
    [k("S1")]: pick(r() < 0.8 ? 1 : 2),
    [k("S2")]: pick(p.sector),
    [k("S3")]: pick(weighted(r, [2, 3, 4], (x) => (x === 4 ? 4 : 2))),
    [k("S4")]: 21 + Math.floor(r() * 35),
    [k("S5")]: pick(p.bank),
    [k("S6")]: pick(weighted(r, [3, 4, 5], (x) => (x === 5 ? 3 : 2))),
    [k("S7")]: {
      selected: shuffle(r, ["c1", "c2", "c3", "c4"])
        .slice(0, 1 + Math.floor(r() * 3))
        .sort(),
    },
    [k("S8a")]: pick(2),
    [k("S8b")]: pick(r() < 0.9 ? 2 : 97),
    [k("S9")]: pick(r() < 0.92 ? 2 : 3),
    [k("S10")]: pick(p.city.option),
    [k("S10_KEC")]: pickOne(r, p.city.kec),
    [k("S10_ALAMAT")]:
      `${pickOne(r, STREETS)} No. ${1 + Math.floor(r() * 180)}, ${p.city.name}`,
  };
}

/** Screening answers that fail at one question (screen-out samples). */
export const SCREEN_OUTS: { code: string; answer: AnswerValue }[] = [
  { code: "S1", answer: pick(3) },
  { code: "S2", answer: pick(3) },
  { code: "S3", answer: pick(1) },
  { code: "S4", answer: 62 },
  { code: "S5", answer: pick(9) },
  { code: "S6", answer: pick(2) },
  { code: "S7", answer: pick(5) },
  { code: "S8a", answer: pick(1) },
  { code: "S8b", answer: pick(1) },
  { code: "S9", answer: pick(1) },
];

function scaleValue(r: Rng, p: Profile, min: number, max: number): number {
  const span = max - min;
  const value = min + span * (p.mood + (r() - 0.5) * 0.45);
  return Math.max(min, Math.min(max, Math.round(value)));
}

function choice(
  r: Rng,
  q: Question,
  options: Option[],
  answers: Answers,
  byKey: Map<string, Question>,
): AnswerValue | undefined {
  let pool = options;
  if (q.notSameAs) {
    const other = byKey.get(q.notSameAs);
    const picked = other ? selectedOptions(other, answers[q.notSameAs]) : [];
    pool = pool.filter((o) => !matchOption(o, picked));
  }
  if (!pool.length) return undefined;
  return { selected: [weighted(r, pool, optionWeight).id] };
}

function multi(
  r: Rng,
  q: Question,
  options: Option[],
  locked: string[],
): AnswerValue | undefined {
  if (!options.length) return undefined;
  const exclusive = options.filter((o) => o.exclusive);
  if (!locked.length && exclusive.length && r() < 0.15)
    return { selected: [pickOne(r, exclusive).id] };
  const max = Math.min(q.validation?.max ?? 4, options.length);
  const n = Math.max(1, Math.min(max, 1 + Math.floor(r() * Math.min(3, max))));
  const free = options.filter((o) => !o.exclusive && !locked.includes(o.id));
  const chosen = [...locked];
  for (const o of shuffle(r, free)) {
    if (chosen.length >= Math.max(n, locked.length)) break;
    if (code(o) >= 97 && r() > 0.2) continue;
    chosen.push(o.id);
  }
  if (!chosen.length) chosen.push(free[0]?.id ?? options[0].id);
  return { selected: chosen.slice(0, Math.max(max, locked.length)) };
}

function answerFor(
  r: Rng,
  q: Question,
  answers: Answers,
  def: FormDefinition,
  p: Profile,
): AnswerValue | undefined {
  const ctx = logicContext(def, answers);
  switch (q.type) {
    case "multiple_choice":
    case "dropdown": {
      const options = effectiveOptions(q, ctx);
      if (q.key === k("G3"))
        return { selected: [`c${scaleValue(r, p, 1, 7)}`] };
      return choice(r, q, options, answers, ctx.byKey);
    }
    case "checkboxes":
      return multi(r, q, effectiveOptions(q, ctx), lockedOptionIds(q, ctx));
    case "ranking": {
      const options = effectiveOptions(q, ctx).filter(
        (o) => code(o) < 97 || r() < 0.1,
      );
      const n = Math.min(
        q.ranking?.max ?? 3,
        options.length,
        1 + Math.floor(r() * 3),
      );
      return n
        ? {
            selected: shuffle(r, options)
              .slice(0, Math.max(1, n))
              .map((o) => o.id),
          }
        : undefined;
    }
    case "grid": {
      const rows = effectiveRows(q, ctx);
      const columns = q.options ?? [];
      const out: Record<string, string[]> = {};
      const limits = new Map(
        (q.grid?.maxPerColumn ?? []).map((m) => [m.optionId, m.max]),
      );
      const used = new Map<string, number>();
      const fixed =
        p.straightline && q.grid?.straightlining
          ? columns[Math.min(columns.length - 1, 3)].id
          : null;
      for (const row of rows) {
        if (q.grid?.multiple) {
          const pickCols = multi(
            r,
            { ...q, validation: { max: 2 } },
            columns,
            [],
          );
          out[row.id] = (pickCols as { selected: string[] }).selected;
          continue;
        }
        let col: Option;
        if (fixed) col = columns.find((c) => c.id === fixed)!;
        else {
          const numeric = columns.filter((c) => code(c) < 97);
          const special = columns.filter((c) => code(c) >= 97);
          if (special.length && r() < 0.06) col = pickOne(r, special);
          else {
            const idx = scaleValue(r, p, 0, numeric.length - 1);
            col = numeric[idx] ?? numeric[0];
          }
        }
        const limit = limits.get(col.id);
        if (limit !== undefined && (used.get(col.id) ?? 0) >= limit)
          col = columns.find((c) => !limits.has(c.id)) ?? col;
        used.set(col.id, (used.get(col.id) ?? 0) + 1);
        out[row.id] = [col.id];
      }
      return Object.keys(out).length ? { rows: out } : undefined;
    }
    case "linear_scale":
      return scaleValue(r, p, q.scale?.min ?? 1, q.scale?.max ?? 5);
    case "rating":
      return scaleValue(r, p, 1, q.rating?.max ?? 5);
    case "number":
      return Math.round((q.validation?.min ?? 1) + r() * 50);
    case "date":
      return "2026-10-01";
    case "phone":
      return `08${1 + Math.floor(r() * 9)}${String(Math.floor(r() * 1e9)).padStart(9, "0")}`;
    case "email":
      return `responden${Math.floor(r() * 1e6)}@contoh.id`;
    case "short_text":
      return "—";
    case "paragraph":
      return "—";
    case "location":
      return {
        lat: Math.round((p.city.lat + (r() - 0.5) * 0.08) * 1e6) / 1e6,
        lng: Math.round((p.city.lng + (r() - 0.5) * 0.08) * 1e6) / 1e6,
        accuracy: 5 + Math.floor(r() * 30),
      };
    case "photo":
      return { photo: SAMPLE_PHOTO };
  }
}

export type SampleInterview = {
  answers: Answers;
  notes: Notes;
  /** Seconds. */
  duration: number;
};

/** One complete interview for a profile (answers valid for the definition). */
export function sampleInterview(
  r: Rng,
  def: FormDefinition,
  p: Profile,
): SampleInterview {
  const answers: Answers = screeningAnswers(r, p);
  const skipped = new Set<string>();
  for (let pass = 0; pass < 400; pass++) {
    const flow = computeFlow(def, answers);
    // One question at a time: later questions depend on earlier answers.
    const q = flow.visible.find(
      (x) => answers[x.key] === undefined && !skipped.has(x.key),
    );
    if (!q) break;
    let value = answerFor(r, q, answers, def, p);
    if (value === undefined && q.required) {
      // Nothing to offer (carry-forward left no option): fall back.
      const fallback =
        q.options?.find((o) => o.code === "99") ?? q.options?.[0];
      if (fallback) value = { selected: [fallback.id] };
    }
    if (value === undefined) skipped.add(q.key);
    else answers[q.key] = value;
  }

  // Fix anything the validator still refuses (rare: limits after carry-forward).
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = validateAnswers(def, answers);
    if (result.ok) break;
    for (const key of Object.keys(result.errors)) {
      const q = flowQuestion(def, key);
      if (!q) continue;
      const value = answerFor(r, q, answers, def, p);
      if (value === undefined) delete answers[key];
      else answers[key] = value;
    }
  }

  const visible = computeFlow(def, answers).visible;
  const notes: Notes = {};
  for (const q of visible) {
    if (!q.noteRequired) continue;
    const said = answerDisplay(q, answers[q.key]);
    notes[q.key] = said
      ? `Responden menyebut: ${said}.`
      : "Responden menjelaskan singkat.";
  }
  // Occasional free notes on other questions.
  for (const q of visible) {
    if (!notes[q.key] && r() < 0.02)
      notes[q.key] = "Responden sempat ragu, jawaban dikonfirmasi ulang.";
  }

  const roll = r();
  const minutes =
    roll < 0.03
      ? 8 + r() * 3
      : roll > 0.97
        ? 46 + r() * 15
        : 17 + r() * 14 + (r() - 0.5) * 6;
  return { answers, notes, duration: Math.round(minutes * 60) };
}

function flowQuestion(def: FormDefinition, key: string): Question | undefined {
  for (const s of def.sections)
    for (const q of s.questions) if (q.key === key) return q;
  return undefined;
}

/** Answers up to a failing screening question (a screen-out sample). */
export function sampleScreenOut(
  r: Rng,
  p: Profile,
): { answers: Answers; code: string } {
  const fail = pickOne(r, SCREEN_OUTS);
  const all = screeningAnswers(r, p);
  const order = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8a", "S8b", "S9"];
  const answers: Answers = {};
  for (const c of order) {
    if (c === fail.code) {
      answers[k(c)] = fail.answer;
      break;
    }
    answers[k(c)] = all[k(c)];
  }
  return { answers, code: fail.code };
}
