"use server";

import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { canCreateForms } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { routing, type Locale } from "@/lib/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { jakartaLocalToUtcIso } from "@/lib/time";
import type { Json } from "@/types/database";
import {
  capiSettingsProblems,
  capiSettingsSchema,
  parseCapiSettings,
  remapCapiKeys,
} from "./capi";
import { hashDefinition } from "./hash";
import { cloneDefinitionWithNewKeys } from "./operations";
import {
  formDefinitionSchema,
  parseAndValidateDefinition,
  type DefinitionProblem,
  type FormDefinition,
} from "./schema";
import {
  MEMBER_ROLES,
  STATUS_ACTIONS,
  formSettingsSchema,
  nextStatus,
} from "./settings";
import { uniqueSlug } from "./slug";
import { TEMPLATE_IDS, instantiateTemplate } from "./templates";

export type FormActionError =
  | "notAllowed"
  | "notFound"
  | "invalidInput"
  | "conflict"
  | "invalidDefinition"
  | "invalidTransition"
  | "slugTaken"
  | "userNotFound"
  | "ownerCannotBeMember"
  | "invalidCapi"
  | "generic";

type Fail = { ok: false; error: FormActionError };
const fail = (error: FormActionError): Fail => ({ ok: false, error });

const formId = z.uuid();

function revalidateForm(id: string) {
  revalidatePath("/[locale]/forms", "page");
  revalidatePath(`/[locale]/forms/${id}`, "layout");
}

async function activeUser() {
  const user = await getCurrentUser();
  return user?.isActive ? user : null;
}

async function currentLocale(): Promise<Locale> {
  const locale = await getLocale();
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

// ---------------------------------------------------------------------------
// Create / duplicate / status / delete
// ---------------------------------------------------------------------------

export async function createFormAction(
  input: unknown,
): Promise<{ ok: true; id: string } | Fail> {
  const user = await activeUser();
  if (!user || !canCreateForms(user.role)) return fail("notAllowed");
  const parsed = z
    .object({ templateId: z.enum(TEMPLATE_IDS) })
    .safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const template = instantiateTemplate(
    parsed.data.templateId,
    await currentLocale(),
  );
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", user.id)
    .single();
  if (!profile) return fail("generic");

  const { data, error } = await supabase
    .from("forms")
    .insert({
      workspace_id: profile.workspace_id,
      owner_id: user.id,
      title: template.title,
      description: template.description ?? null,
      thank_you_message: template.thankYouMessage ?? null,
      slug: uniqueSlug(template.title),
      draft_definition: template.definition as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error || !data)
    return fail(error?.code === "42501" ? "notAllowed" : "generic");

  revalidatePath("/[locale]/forms", "page");
  return { ok: true, id: data.id };
}

export async function duplicateFormAction(
  input: unknown,
): Promise<{ ok: true; id: string } | Fail> {
  const user = await activeUser();
  if (!user || !canCreateForms(user.role)) return fail("notAllowed");
  const id = formId.safeParse(input);
  if (!id.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("forms")
    .select("*")
    .eq("id", id.data)
    .maybeSingle();
  if (!source) return fail("notFound");
  const definition = formDefinitionSchema.safeParse(source.draft_definition);
  if (!definition.success) return fail("invalidDefinition");

  const t = await getTranslations("forms");
  const title = t("copyTitle", { title: source.title }).slice(0, 300);
  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", user.id)
    .single();
  if (!profile) return fail("generic");

  // New question keys: the copy is a different form with its own analytics.
  const copy = cloneDefinitionWithNewKeys(definition.data);
  const { data, error } = await supabase
    .from("forms")
    .insert({
      workspace_id: profile.workspace_id,
      owner_id: user.id,
      title,
      description: source.description,
      identifier_mode: source.identifier_mode,
      closed_message: source.closed_message,
      thank_you_message: source.thank_you_message,
      slug: uniqueSlug(title),
      draft_definition: copy as unknown as NonNullable<Json>,
      // Interview settings follow the new keys (quotas, respondent IDs, QC).
      capi_settings: remapCapiKeys(
        parseCapiSettings(source.capi_settings),
        definition.data,
        copy,
      ) as unknown as NonNullable<Json>,
    })
    .select("id")
    .single();
  if (error || !data) return fail("generic");

  revalidatePath("/[locale]/forms", "page");
  return { ok: true, id: data.id };
}

export async function setFormStatusAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const parsed = z
    .object({ formId, action: z.enum(STATUS_ACTIONS) })
    .safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data: form } = await supabase
    .from("forms")
    .select("status, current_version_id")
    .eq("id", parsed.data.formId)
    .maybeSingle();
  if (!form) return fail("notFound");

  const status = nextStatus(
    form.status,
    parsed.data.action,
    Boolean(form.current_version_id),
  );
  if (!status) return fail("invalidTransition");

  const { data, error } = await supabase
    .from("forms")
    .update({ status })
    .eq("id", parsed.data.formId)
    .select("id");
  if (error) return fail("generic");
  if (!data?.length) return fail("notAllowed");

  revalidateForm(parsed.data.formId);
  return { ok: true };
}

export async function deleteFormAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input);
  if (!id.success) return fail("invalidInput");

  // RLS: only admins and the owner can delete. Responses cascade.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forms")
    .delete()
    .eq("id", id.data)
    .select("id");
  if (error) return fail("generic");
  if (!data?.length) return fail("notAllowed");

  revalidatePath("/[locale]/forms", "page");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Draft autosave and publishing
// ---------------------------------------------------------------------------

export type SaveDraftResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: "conflict"; serverUpdatedAt: string }
  | Fail;

/**
 * Saves the draft with optimistic concurrency on updated_at. With `force`,
 * the caller explicitly chose to overwrite a newer draft.
 */
export async function saveDraftAction(input: {
  formId: string;
  definition: unknown;
  expectedUpdatedAt: string;
  force?: boolean;
}): Promise<SaveDraftResult> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input.formId);
  const definition = formDefinitionSchema.safeParse(input.definition);
  if (
    !id.success ||
    !definition.success ||
    typeof input.expectedUpdatedAt !== "string"
  ) {
    return fail("invalidInput");
  }

  const supabase = await createClient();
  let query = supabase
    .from("forms")
    .update({
      draft_definition: definition.data as unknown as NonNullable<Json>,
    })
    .eq("id", id.data);
  if (!input.force) query = query.eq("updated_at", input.expectedUpdatedAt);
  const { data, error } = await query.select("updated_at");
  if (error) return fail(error.code === "42501" ? "notAllowed" : "generic");
  if (data?.length) return { ok: true, updatedAt: data[0].updated_at };

  // Nothing updated: either someone saved a newer draft, or we cannot edit.
  const { data: current } = await supabase
    .from("forms")
    .select("updated_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!current) return fail("notFound");
  const { data: canEdit } = await supabase.rpc("can_edit_form", {
    p_form_id: id.data,
  });
  if (!canEdit) return fail("notAllowed");
  return { ok: false, error: "conflict", serverUpdatedAt: current.updated_at };
}

export async function loadDraftAction(
  input: unknown,
): Promise<{ ok: true; definition: FormDefinition; updatedAt: string } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input);
  if (!id.success) return fail("invalidInput");
  const supabase = await createClient();
  const { data } = await supabase
    .from("forms")
    .select("draft_definition, updated_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!data) return fail("notFound");
  const definition = formDefinitionSchema.safeParse(data.draft_definition);
  if (!definition.success) return fail("invalidDefinition");
  return { ok: true, definition: definition.data, updatedAt: data.updated_at };
}

export type PublishResult =
  | { ok: true; versionNumber: number; updatedAt: string; hash: string }
  | { ok: false; error: "invalidDefinition"; problems: DefinitionProblem[] }
  | Fail;

/** Validates the SAVED draft with the shared Zod schema, then calls publish_form. */
export async function publishFormAction(input: {
  formId: string;
  expectedUpdatedAt: string;
}): Promise<PublishResult> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input.formId);
  if (!id.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data: form } = await supabase
    .from("forms")
    .select("draft_definition, updated_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!form) return fail("notFound");
  if (form.updated_at !== input.expectedUpdatedAt) return fail("conflict");

  const validated = parseAndValidateDefinition(form.draft_definition);
  if (!validated.ok)
    return {
      ok: false,
      error: "invalidDefinition",
      problems: validated.problems,
    };

  const { data, error } = await supabase
    .rpc("publish_form", {
      p_form_id: id.data,
      p_expected_updated_at: form.updated_at,
    })
    .single();
  if (error || !data) {
    if (error?.code === "42501") return fail("notAllowed");
    if (error?.code === "40001") return fail("conflict");
    return fail("generic");
  }

  revalidateForm(id.data);
  return {
    ok: true,
    versionNumber: data.version_number,
    updatedAt: data.updated_at,
    hash: hashDefinition(validated.definition),
  };
}

// ---------------------------------------------------------------------------
// Settings and sharing
// ---------------------------------------------------------------------------

export async function checkSlugAction(input: {
  slug: string;
  formId: string;
}): Promise<boolean> {
  if (!(await activeUser())) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_slug_available", {
    p_slug: String(input.slug).toLowerCase(),
    p_form_id: input.formId,
  });
  return Boolean(data);
}

export async function updateSettingsAction(input: {
  formId: string;
  values: unknown;
}): Promise<{ ok: true; updatedAt: string } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input.formId);
  const values = formSettingsSchema.safeParse(input.values);
  if (!id.success || !values.success) return fail("invalidInput");
  const v = values.data;

  const supabase = await createClient();
  const { data: available } = await supabase.rpc("is_slug_available", {
    p_slug: v.slug,
    p_form_id: id.data,
  });
  if (!available) return fail("slugTaken");

  const { data, error } = await supabase
    .from("forms")
    .update({
      title: v.title,
      description: v.description || null,
      slug: v.slug,
      identifier_mode: v.identifierMode,
      deadline_at: v.deadlineLocal
        ? jakartaLocalToUtcIso(v.deadlineLocal)
        : null,
      closed_message: v.closedMessage || null,
      thank_you_message: v.thankYouMessage || null,
    })
    .eq("id", id.data)
    .select("updated_at");
  if (error) return fail(error.code === "23505" ? "slugTaken" : "generic");
  if (!data?.length) return fail("notAllowed");

  revalidateForm(id.data);
  return { ok: true, updatedAt: data[0].updated_at };
}

const memberInput = z.object({ formId, role: z.enum(MEMBER_ROLES) });

export async function addMemberAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const parsed = memberInput
    .extend({ email: z.email().max(320) })
    .safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_form_member", {
    p_form_id: parsed.data.formId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) {
    if (error.code === "42501") return fail("notAllowed");
    if (error.code === "P0002") return fail("userNotFound");
    if (error.code === "22023") return fail("ownerCannotBeMember");
    return fail("generic");
  }
  revalidateForm(parsed.data.formId);
  return { ok: true };
}

export async function updateMemberRoleAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const parsed = memberInput.extend({ userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("form_members")
    .update({ role: parsed.data.role })
    .eq("form_id", parsed.data.formId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error) return fail("generic");
  if (!data?.length) return fail("notAllowed");
  revalidateForm(parsed.data.formId);
  return { ok: true };
}

export async function removeMemberAction(
  input: unknown,
): Promise<{ ok: true } | Fail> {
  if (!(await activeUser())) return fail("notAllowed");
  const parsed = z.object({ formId, userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("form_members")
    .delete()
    .eq("form_id", parsed.data.formId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error) return fail("generic");
  if (!data?.length) return fail("notAllowed");
  revalidateForm(parsed.data.formId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Interview (CAPI) settings
// ---------------------------------------------------------------------------

export async function saveCapiSettingsAction(input: {
  formId: string;
  settings: unknown;
}): Promise<{ ok: true } | (Fail & { problems?: string[] })> {
  if (!(await activeUser())) return fail("notAllowed");
  const id = formId.safeParse(input.formId);
  const settings = capiSettingsSchema.safeParse(input.settings);
  if (!id.success || !settings.success) return fail("invalidInput");

  const supabase = await createClient();
  const { data: form } = await supabase
    .from("forms")
    .select("draft_definition")
    .eq("id", id.data)
    .maybeSingle();
  if (!form) return fail("notFound");
  const definition = formDefinitionSchema.safeParse(form.draft_definition);
  const problems = capiSettingsProblems(
    settings.data,
    definition.success ? definition.data : null,
  );
  if (problems.length) return { ...fail("invalidCapi"), problems };

  // RLS: only people who can edit the form update it.
  const { data, error } = await supabase
    .from("forms")
    .update({ capi_settings: settings.data as unknown as NonNullable<Json> })
    .eq("id", id.data)
    .select("id");
  if (error) return fail("generic");
  if (!data?.length) return fail("notAllowed");
  revalidateForm(id.data);
  return { ok: true };
}
