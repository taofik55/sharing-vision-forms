/**
 * Asia/Jakarta helpers. WIB is a fixed UTC+7 offset (no daylight saving since
 * 1964), so conversions do not need a timezone database.
 */
export const APP_TIME_ZONE = "Asia/Jakarta";
const OFFSET_MS = 7 * 60 * 60 * 1000;

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-10-13T17:30" (Jakarta wall time) -> "2026-10-13T10:30:00.000Z". */
export function jakartaLocalToUtcIso(local: string): string | null {
  const m = LOCAL_PATTERN.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) - OFFSET_MS;
  const check = new Date(utc + OFFSET_MS);
  if (
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  )
    return null;
  return new Date(utc).toISOString();
}

/** UTC ISO timestamp -> "YYYY-MM-DDTHH:mm" Jakarta wall time (for datetime-local inputs). */
export function utcIsoToJakartaLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  return new Date(time + OFFSET_MS).toISOString().slice(0, 16);
}
