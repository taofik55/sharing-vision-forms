"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/lib/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "./paths";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const locale = await getLocale();
  redirect({
    href: { pathname: LOGIN_PATH, query: { signedOut: "1" } },
    locale,
  });
}
