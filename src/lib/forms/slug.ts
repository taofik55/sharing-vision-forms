import { customAlphabet } from "nanoid";

/** Public slugs: lowercase letters, digits and single dashes, 3–80 chars. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,79}$/;

const suffix = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 6);

export function slugify(text: string, maxLength = 60): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `form${base ? `-${base}` : ""}`;
}

/** Slug from a title plus a short random suffix, to avoid collisions on create. */
export function uniqueSlug(title: string): string {
  return `${slugify(title, 50)}-${suffix()}`;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
