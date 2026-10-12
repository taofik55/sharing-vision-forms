"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { mapAuthError, type LoginErrorKey } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/paths";
import { redirect } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export type LoginState = {
  error: LoginErrorKey | null;
  email: string;
};

export async function signIn(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    next: String(formData.get("next") ?? "/"),
  };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "invalidInput", email: raw.email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user)
    return { error: mapAuthError(error), email: raw.email };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "inactive", email: raw.email };
  }

  const locale = await getLocale();
  return redirect({ href: safeNextPath(parsed.data.next), locale });
}
