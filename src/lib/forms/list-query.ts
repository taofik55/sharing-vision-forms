import { z } from "zod";

export const FORM_STATUSES = [
  "draft",
  "published",
  "closed",
  "archived",
] as const;
export const FORM_SCOPES = ["all", "mine", "shared"] as const;
export const FORM_SORTS = [
  "updated_desc",
  "updated_asc",
  "created_desc",
  "title_asc",
  "title_desc",
  "responses_desc",
  "last_response_desc",
] as const;
export const FORMS_PAGE_SIZE = 20;

const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Parses /forms search params; invalid values fall back to defaults. */
export const formsQuerySchema = z.object({
  q: z.preprocess(one, z.string().trim().max(200).catch("")).default(""),
  status: z
    .preprocess(one, z.enum(FORM_STATUSES).nullable().catch(null))
    .default(null),
  owner: z.preprocess(one, z.uuid().nullable().catch(null)).default(null),
  scope: z.preprocess(one, z.enum(FORM_SCOPES).catch("all")).default("all"),
  sort: z
    .preprocess(one, z.enum(FORM_SORTS).catch("updated_desc"))
    .default("updated_desc"),
  view: z
    .preprocess(one, z.enum(["table", "cards"]).catch("table"))
    .default("table"),
  page: z
    .preprocess(one, z.coerce.number().int().min(1).max(10_000).catch(1))
    .default(1),
});

export type FormsQuery = z.output<typeof formsQuerySchema>;

export function parseFormsQuery(
  params: Record<string, string | string[] | undefined>,
): FormsQuery {
  return formsQuerySchema.parse(params);
}
