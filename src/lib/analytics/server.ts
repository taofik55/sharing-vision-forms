import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  formDefinitionSchema,
  type FormDefinition,
  type Question,
} from "@/lib/forms/schema";

export type VersionInfo = { id: string; number: number };

/**
 * Published versions of a form and a question index with the latest
 * definition of every key ever published (for removed questions). Uses the
 * signed-in user (RLS: view access) unless a client is passed (public
 * dashboards pass the admin client after validating the share token).
 */
export async function loadFormVersions(
  formId: string,
  currentVersionId: string | null,
  client?: SupabaseClient<Database>,
) {
  const supabase = client ?? (await createClient());
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

/** Current version's order first, then questions that were removed later. */
export function orderedQuestions(
  questions: Record<string, Question>,
  current: FormDefinition | null,
): Question[] {
  const currentKeys =
    current?.sections.flatMap((s) => s.questions.map((q) => q.key)) ?? [];
  const seen = new Set(currentKeys);
  return [
    ...currentKeys.map((key) => questions[key]).filter(Boolean),
    ...Object.values(questions).filter((q) => !seen.has(q.key)),
  ];
}
