/**
 * Small statistics helpers. The database computes the dashboard numbers;
 * these are used for client-side derivations (KPI cards, trends) and to
 * verify SQL results in tests. Quantiles match Postgres percentile_cont.
 */

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Linear interpolation between closest ranks (= percentile_cont). */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return Math.sqrt(
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1),
  );
}

type Distribution = { value: number; count: number }[];

/** Net Promoter Score on a 0–10 scale: % promoters (9–10) − % detractors (0–6). */
export function nps(distribution: Distribution): number | null {
  const n = distribution.reduce((acc, d) => acc + d.count, 0);
  if (!n) return null;
  const promoters = distribution
    .filter((d) => d.value >= 9)
    .reduce((a, d) => a + d.count, 0);
  const detractors = distribution
    .filter((d) => d.value <= 6)
    .reduce((a, d) => a + d.count, 0);
  return round(((promoters - detractors) * 100) / n, 1);
}

/** CSAT on a 1–5 scale: share of 4 and 5. */
export function csat(distribution: Distribution): number | null {
  const n = distribution.reduce((acc, d) => acc + d.count, 0);
  if (!n) return null;
  const satisfied = distribution
    .filter((d) => d.value >= 4)
    .reduce((a, d) => a + d.count, 0);
  return round((satisfied * 100) / n, 1);
}

/** Mean from a value/count distribution. */
export function distributionMean(distribution: Distribution): number | null {
  const n = distribution.reduce((acc, d) => acc + d.count, 0);
  if (!n) return null;
  return distribution.reduce((acc, d) => acc + d.value * d.count, 0) / n;
}

/** Relative change in percent; null when there is no baseline. */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return round(((current - previous) * 100) / previous, 1);
}

export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Sturges' rule for histogram bucket count (same as the SQL). */
export function sturges(n: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(n, 1)) + 1));
}
