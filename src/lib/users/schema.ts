import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";

export const appRoleSchema = z.enum(APP_ROLES);

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  fullName: z.string().trim().min(1).max(200),
  role: appRoleSchema,
  password: z.string().min(8).max(72),
});

export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateRoleSchema = z.object({
  userId: z.uuid(),
  role: appRoleSchema,
});

export const setActiveSchema = z.object({
  userId: z.uuid(),
  active: z.boolean(),
});

export type AdminUserErrorKey =
  | "invalidInput"
  | "emailTaken"
  | "cannotChangeSelf"
  | "notAllowed"
  | "notFound"
  | "generic";

export type AdminActionResult =
  { ok: true } | { ok: false; error: AdminUserErrorKey };
