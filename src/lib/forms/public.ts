import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCapiSettings } from "./capi";
import type { IdentifierMode } from "./identifier";
import { formDefinitionSchema, type FormDefinition } from "./schema";

/**
 * Public (respondent) access to forms. Uses the admin client, so every query
 * selects an explicit, minimal column list: never draft_definition, owner or
 * anything else.
 */

const SLUG = /^[A-Za-z0-9_-]{3,100}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PublicFormDto = {
  formId: string;
  slug: string;
  title: string;
  description: string | null;
  versionId: string;
  definition: FormDefinition;
  identifierMode: IdentifierMode;
  deadlineAt: string | null;
  /** Deadline within the next 24 hours. */
  closesSoon: boolean;
  thankYouMessage: string | null;
};

export type PublicFormState =
  | { state: "open"; form: PublicFormDto }
  /** Interview-only form (CAPI): no public link. */
  | { state: "interview"; title: string; formId: string }
  | { state: "closed"; title: string; closedMessage: string | null }
  | { state: "not_found" };

const FORM_COLUMNS =
  "id, slug, title, description, status, current_version_id, identifier_mode, deadline_at, closed_message, thank_you_message, capi_settings";

export type SubmitFormRow = {
  id: string;
  capi_settings: unknown;
  status: "draft" | "published" | "closed" | "archived";
  current_version_id: string | null;
  identifier_mode: IdentifierMode;
  deadline_at: string | null;
};

export function isPastDeadline(
  deadlineAt: string | null,
  now = Date.now(),
): boolean {
  return deadlineAt !== null && now > new Date(deadlineAt).getTime();
}

/** Form row needed by the submit / draft routes (no content). */
export async function findFormForRespondent(
  slug: string,
): Promise<SubmitFormRow | null> {
  if (!SLUG.test(slug)) return null;
  const { data } = await createAdminClient()
    .from("forms")
    .select(
      "id, status, current_version_id, identifier_mode, deadline_at, capi_settings",
    )
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

/** Definition of a version, only if it belongs to the form. */
export async function loadVersionDefinition(
  formId: string,
  versionId: string,
): Promise<FormDefinition | null> {
  const { data } = await createAdminClient()
    .from("form_versions")
    .select("definition")
    .eq("id", versionId)
    .eq("form_id", formId)
    .maybeSingle();
  if (!data) return null;
  const parsed = formDefinitionSchema.safeParse(data.definition);
  return parsed.success ? parsed.data : null;
}

/** What a respondent may see for /f/<slug>. Memoized per request. */
export const loadPublicForm = cache(
  async (slug: string): Promise<PublicFormState> => {
    if (!SLUG.test(slug)) return { state: "not_found" };
    const { data: form } = await createAdminClient()
      .from("forms")
      .select(FORM_COLUMNS)
      .eq("slug", slug)
      .maybeSingle();

    // Never-published drafts do not exist publicly.
    if (!form || !form.current_version_id || form.status === "draft")
      return { state: "not_found" };

    if (parseCapiSettings(form.capi_settings).enabled)
      return { state: "interview", title: form.title, formId: form.id };

    if (form.status !== "published" || isPastDeadline(form.deadline_at)) {
      return {
        state: "closed",
        title: form.title,
        closedMessage: form.closed_message,
      };
    }

    const definition = await loadVersionDefinition(
      form.id,
      form.current_version_id,
    );
    if (!definition) return { state: "not_found" };

    const deadline = form.deadline_at
      ? new Date(form.deadline_at).getTime()
      : null;
    return {
      state: "open",
      form: {
        formId: form.id,
        slug: form.slug,
        title: form.title,
        description: form.description,
        versionId: form.current_version_id,
        definition,
        identifierMode: form.identifier_mode,
        deadlineAt: form.deadline_at,
        closesSoon: deadline !== null && deadline - Date.now() < DAY_MS,
        thankYouMessage: form.thank_you_message,
      },
    };
  },
);
