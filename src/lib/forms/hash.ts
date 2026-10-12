/**
 * Stable hash of a JSON value. Object keys are sorted, so a definition that
 * round-trips through Postgres jsonb (which reorders keys) hashes the same.
 * Used to show the "Unpublished changes" badge.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** 64-bit FNV-1a as 16 hex chars. Not cryptographic; change detection only. */
export function hashDefinition(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}
