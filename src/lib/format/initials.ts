/** "Ada Lovelace" -> "AL", "admin@x.test" -> "A". Max two letters. */
export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@")
    ? nameOrEmail.split("@")[0]
    : nameOrEmail;
  const parts = base
    .split(/[\s._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (nameOrEmail.includes("@")) return parts[0][0].toUpperCase();
  return parts
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}
