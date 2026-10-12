import type { PaletteId } from "@/lib/analytics/config";

const SERIES = 8;
const SEQUENTIAL = [
  "--seq-250",
  "--seq-300",
  "--seq-400",
  "--seq-500",
  "--seq-600",
  "--seq-700",
];

/**
 * Color for the i-th item. Categorical slots are assigned in fixed order and
 * never cycled: items past slot 8 share the last slot and the UI folds them
 * (tables and labels always carry identity, never color alone).
 * Sequential is for ordered values (scores), mono for a single series.
 */
export function colorAt(
  index: number,
  palette: PaletteId = "categorical",
  total = 1,
): string {
  if (palette === "mono") return "var(--series-1)";
  if (palette === "sequential") {
    if (total <= 1) return `var(${SEQUENTIAL[2]})`;
    const step = Math.round((index / (total - 1)) * (SEQUENTIAL.length - 1));
    return `var(${SEQUENTIAL[step]})`;
  }
  return `var(--series-${Math.min(index, SERIES - 1) + 1})`;
}

/** Heatmap cell color from 0..1 (sequential blue ramp; 0 = empty track). */
export function heatColor(ratio: number): string {
  if (ratio <= 0) return "var(--muted)";
  const steps = [
    "--seq-100",
    "--seq-200",
    "--seq-300",
    "--seq-400",
    "--seq-500",
    "--seq-600",
    "--seq-700",
  ];
  return `var(${steps[Math.min(steps.length - 1, Math.floor(ratio * steps.length))]})`;
}
