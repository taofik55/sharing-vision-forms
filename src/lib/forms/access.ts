import "server-only";
import { forbidden, notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type FormRow = Database["public"]["Tables"]["forms"]["Row"];

export type FormAccess = {
  form: FormRow;
  user: CurrentUser;
  canEdit: boolean;
  isOwner: boolean;
  /** Admin or owner: may share, delete. */
  canManage: boolean;
};

const uuid = z.uuid();

/**
 * Loads a form through RLS. Returns null when the caller cannot view it
 * (we do not reveal whether the form exists). Memoized per request.
 */
export const getFormAccess = cache(
  async (formId: string): Promise<FormAccess | null> => {
    if (!uuid.safeParse(formId).success) return null;
    const user = await requireUser();
    const supabase = await createClient();
    const { data: form } = await supabase
      .from("forms")
      .select("*")
      .eq("id", formId)
      .maybeSingle();
    if (!form) return null;

    const { data: canEdit } = await supabase.rpc("can_edit_form", {
      p_form_id: formId,
    });
    const isOwner = form.owner_id === user.id;
    return {
      form,
      user,
      canEdit: Boolean(canEdit),
      isOwner,
      canManage: isOwner || user.role === "admin",
    };
  },
);

/** 404 if not viewable, 403 if `edit` is required and the caller can only view. */
export async function requireFormAccess(
  formId: string,
  level: "view" | "edit",
): Promise<FormAccess> {
  const access = await getFormAccess(formId);
  if (!access) notFound();
  if (level === "edit" && !access.canEdit) forbidden();
  return access;
}
