import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseCapiSettings, type CapiSettings } from "./capi";
import { isPhotoAnswer, type Answers } from "./logic";
import { loadVersionDefinition } from "./public";
import { flattenQuestions, type FormDefinition } from "./schema";
import type { PhotoIds } from "./submission";

export type InterviewForm = {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed" | "archived";
  versionId: string | null;
  settings: CapiSettings;
  thankYouMessage: string | null;
  deadlineAt: string | null;
};

/** Form row for interviews (explicit columns only; admin client). */
export async function loadInterviewForm(
  formId: string,
): Promise<InterviewForm | null> {
  if (!/^[0-9a-f-]{36}$/i.test(formId)) return null;
  const { data } = await createAdminClient()
    .from("forms")
    .select(
      "id, title, description, status, current_version_id, capi_settings, thank_you_message, deadline_at",
    )
    .eq("id", formId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    status: data.status,
    versionId: data.current_version_id,
    settings: parseCapiSettings(data.capi_settings),
    thankYouMessage: data.thank_you_message,
    deadlineAt: data.deadline_at,
  };
}

/**
 * The signed-in user if they may run interviews for this form (admin, owner,
 * editor or assigned surveyor). Uses the user's own session (RLS helpers).
 */
export async function interviewer(
  formId: string,
): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.rpc("can_interview", { p_form_id: formId });
  return data === true ? { id: user.id } : null;
}

export async function interviewDefinition(
  form: InterviewForm,
  versionId: string,
): Promise<FormDefinition | null> {
  return loadVersionDefinition(form.id, versionId);
}

export type PhotoUpload = { id: string; mime: string; data: string };

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
/** ~3 MB of image bytes per photo (the database check). */
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/**
 * Splits photo answers (data URLs) into uploads and ids. Answers keep the
 * data URL for validation; rows store `{ photoId }`.
 */
export function extractPhotos(
  definition: FormDefinition,
  answers: Answers,
): { photos: PhotoUpload[]; photoIds: PhotoIds } | null {
  const photos: PhotoUpload[] = [];
  const photoIds: PhotoIds = {};
  for (const q of flattenQuestions(definition)) {
    if (q.type !== "photo") continue;
    const value = answers[q.key];
    if (!isPhotoAnswer(value) || !value.photo) continue;
    const match = DATA_URL.exec(value.photo);
    if (!match) return null;
    if ((match[2].length * 3) / 4 > MAX_PHOTO_BYTES) return null;
    const id = randomUUID();
    photos.push({ id, mime: match[1], data: match[2] });
    photoIds[q.key] = id;
  }
  return { photos, photoIds };
}

/** Answers without photo bytes (stored with screen-outs). */
export function withoutPhotos(
  definition: FormDefinition,
  answers: Answers,
): Answers {
  const photoKeys = new Set(
    flattenQuestions(definition)
      .filter((q) => q.type === "photo")
      .map((q) => q.key),
  );
  return Object.fromEntries(
    Object.entries(answers).filter(([k]) => !photoKeys.has(k)),
  );
}
