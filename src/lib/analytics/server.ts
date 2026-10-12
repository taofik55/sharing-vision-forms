import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  formDefinitionSchema,
  type FormDefinition,
  type Question,
} from "@/lib/forms/schema";

export type VersionInfo = { id: string; number: number };

/**
 * Published versions of a form (RLS: view access) and a question index with
 * the latest definition of every key ever published (for removed questions).
 */
export async function loadFormVersions(
  formId: string,
  currentVersionId: string | null,
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("form_versions")
    .select("id, version_number, definition")
    .eq("form_id", formId)
    .order("version_number");

  const versions: VersionInfo[] = [];
  const questions: Record<string, Question> = {};
  let current: FormDefinition | null = null;
  for (const row of data ?? []) {
    const parsed = formDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) continue;
    versions.push({ id: row.id, number: row.version_number });
    for (const section of parsed.data.sections) {
      for (const q of section.questions) questions[q.key] = q; // later versions win
    }
    if (row.id === currentVersionId) current = parsed.data;
  }
  return { versions, questions, current };
}
