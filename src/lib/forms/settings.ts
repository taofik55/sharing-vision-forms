import { z } from "zod";
import { jakartaLocalToUtcIso } from "@/lib/time";
import { IDENTIFIER_MODES } from "./identifier";
import { SLUG_PATTERN } from "./slug";

export { IDENTIFIER_MODES };

export const MEMBER_ROLES = ["viewer", "editor"] as const;

/** Form settings (not the definition). The deadline is Jakarta wall time. */
export const formSettingsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { error: "title" })
    .max(300, { error: "title" }),
  description: z.string().trim().max(2000, { error: "description" }),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, { error: "slug" }),
  identifierMode: z.enum(IDENTIFIER_MODES),
  deadlineLocal: z
    .string()
    .refine((v) => v === "" || jakartaLocalToUtcIso(v) !== null, {
      error: "deadline",
    }),
  closedMessage: z.string().trim().max(2000, { error: "message" }),
  thankYouMessage: z.string().trim().max(2000, { error: "message" }),
});

export type FormSettingsInput = z.input<typeof formSettingsSchema>;
export type FormSettingsValues = z.output<typeof formSettingsSchema>;

export const STATUS_ACTIONS = [
  "close",
  "reopen",
  "archive",
  "restore",
] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

type FormStatus = "draft" | "published" | "closed" | "archived";

/** Allowed status transitions. Restoring never re-opens a form publicly. */
export function nextStatus(
  current: FormStatus,
  action: StatusAction,
  hasVersion: boolean,
): FormStatus | null {
  switch (action) {
    case "close":
      return current === "published" ? "closed" : null;
    case "reopen":
      return current === "closed" ? "published" : null;
    case "archive":
      return current === "archived" ? null : "archived";
    case "restore":
      return current === "archived" ? (hasVersion ? "closed" : "draft") : null;
  }
}
