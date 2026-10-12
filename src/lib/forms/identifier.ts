/**
 * Respondent identifiers (email / phone) used to allow one response per
 * person. Shared by the identifier step (client) and the submit route (server).
 *
 * NOTE: identifiers are NOT verified (no email/SMS confirmation). They stop
 * accidental double submissions, not a determined person with two addresses.
 */
import { z } from "zod";

export const IDENTIFIER_MODES = [
  "none",
  "email",
  "phone",
  "email_or_phone",
] as const;
export type IdentifierMode = (typeof IDENTIFIER_MODES)[number];

export type IdentifierInput = { email?: string | null; phone?: string | null };

export type Identifier = {
  /** Normalized email (trimmed, lowercase) or null. */
  email: string | null;
  /** Normalized phone (digits only, Indonesian numbers as 62...) or null. */
  phone: string | null;
  /** Value stored in responses.identifier_key. Email wins when both are given. */
  key: string | null;
};

export type IdentifierError =
  | "emailRequired"
  | "phoneRequired"
  | "identifierRequired"
  | "invalidEmail"
  | "invalidPhone";

const emailSchema = z.email().max(320);

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return emailSchema.safeParse(email).success ? email : null;
}

/**
 * Digits only, with Indonesian conventions:
 *   0812-3456-7890 -> 6281234567890   (leading 0 = domestic)
 *   +62 812 ...    -> 62812...
 *   0062 812 ...   -> 62812...        (international dialing prefix)
 *   812 3456 7890  -> 6281234567890   (mobile number typed without 0)
 * Other countries keep their country code (+1 415... -> 1415...).
 * Valid results have 8 to 15 digits (E.164 maximum).
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[^\d\s()+.\-/]/.test(trimmed)) return null;
  if (trimmed.indexOf("+") > 0 || (trimmed.match(/\+/g)?.length ?? 0) > 1)
    return null;
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    // Already international: keep as is.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = `62${digits.slice(1)}`;
  } else if (
    digits.startsWith("8") &&
    digits.length >= 9 &&
    digits.length <= 12
  ) {
    digits = `62${digits}`;
  }

  // "+62 0812..." is a common mistake: drop the trunk 0 after the country code.
  if (digits.startsWith("620")) digits = `62${digits.slice(3)}`;

  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Validates and normalizes the identifier for the form's mode. */
export function buildIdentifier(
  mode: IdentifierMode,
  input: IdentifierInput,
):
  | { ok: true; identifier: Identifier }
  | { ok: false; errors: Partial<Record<"email" | "phone", IdentifierError>> } {
  const none: Identifier = { email: null, phone: null, key: null };
  if (mode === "none") return { ok: true, identifier: none };

  const rawEmail = input.email?.trim() ?? "";
  const rawPhone = input.phone?.trim() ?? "";
  const wantsEmail = mode === "email" || mode === "email_or_phone";
  const wantsPhone = mode === "phone" || mode === "email_or_phone";
  const errors: Partial<Record<"email" | "phone", IdentifierError>> = {};

  const email = wantsEmail && rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = wantsPhone && rawPhone ? normalizePhone(rawPhone) : null;
  if (wantsEmail && rawEmail && !email) errors.email = "invalidEmail";
  if (wantsPhone && rawPhone && !phone) errors.phone = "invalidPhone";

  if (mode === "email" && !rawEmail) errors.email = "emailRequired";
  if (mode === "phone" && !rawPhone) errors.phone = "phoneRequired";
  if (mode === "email_or_phone" && !rawEmail && !rawPhone) {
    errors.email = "identifierRequired";
    errors.phone = "identifierRequired";
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return { ok: true, identifier: { email, phone, key: email ?? phone } };
}
