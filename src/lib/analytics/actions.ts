"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { dashboardConfigSchema } from "./config";

type Result =
  | { ok: true; updatedAt: string }
  | { ok: false; error: "notAllowed" | "invalidInput" | "generic" };

/** Saves dashboards.config. RLS allows insert/update only with can_edit_form. */
export async function saveDashboardAction(input: {
  formId: string;
  config: unknown;
}): Promise<Result> {
  const user = await getCurrentUser();
  if (!user?.isActive) return { ok: false, error: "notAllowed" };
  const formId = z.uuid().safeParse(input.formId);
  const config = dashboardConfigSchema.safeParse(input.config);
  if (!formId.success || !config.success)
    return { ok: false, error: "invalidInput" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboards")
    .upsert(
      {
        form_id: formId.data,
        config: config.data as unknown as NonNullable<Json>,
        updated_by: user.id,
      },
      { onConflict: "form_id" },
    )
    .select("updated_at");
  if (error)
    return {
      ok: false,
      error: error.code === "42501" ? "notAllowed" : "generic",
    };
  if (!data?.length) return { ok: false, error: "notAllowed" };
  return { ok: true, updatedAt: data[0].updated_at };
}

/** Deletes one response. RLS: admin or form owner only; answers cascade. */
export async function deleteResponseAction(input: {
  responseId: string;
}): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user?.isActive) return { ok: false };
  const id = z.uuid().safeParse(input.responseId);
  if (!id.success) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("responses")
    .delete()
    .eq("id", id.data)
    .select("id");
  return { ok: !error && Boolean(data?.length) };
}
