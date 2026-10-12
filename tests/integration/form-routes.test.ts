/**
 * HTTP-level checks for form routes (needs the app at APP_URL, e.g. `pnpm dev`;
 * skipped with a notice otherwise):
 * - a shared viewer can open the dashboard placeholder without edit controls
 * - the builder and settings routes return 403 for that viewer
 * - a user without access gets 404 (existence is not revealed)
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instantiateTemplate } from "@/lib/forms/templates";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  adminClient,
  profileId,
  sessionCookieHeader,
} from "./helpers";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

async function appIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/id/login`, { redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  }
}

const up = await appIsUp();
if (!up)
  console.warn(
    `[form-routes.test] ${APP_URL} not reachable: skipping HTTP route tests.`,
  );

describe.skipIf(!up)("form routes (HTTP)", () => {
  const admin = adminClient();
  let formId: string;
  let privateFormId: string;

  beforeAll(async () => {
    const { data, error } = await admin
      .from("forms")
      .insert({
        workspace_id: DEFAULT_WORKSPACE_ID,
        owner_id: await profileId(DUMMY.editor),
        title: "Route fixture",
        slug: `it-routes-${randomUUID().slice(0, 8)}`,
        draft_definition: instantiateTemplate("blank", "en")
          .definition as unknown as NonNullable<Json>,
      })
      .select("id")
      .single();
    if (error) throw error;
    formId = data.id;
    await admin.from("form_members").insert({
      form_id: formId,
      user_id: await profileId(DUMMY.viewer),
      role: "viewer",
    });

    // Owned by the admin and shared with nobody.
    const { data: privateForm, error: privateError } = await admin
      .from("forms")
      .insert({
        workspace_id: DEFAULT_WORKSPACE_ID,
        owner_id: await profileId(DUMMY.admin),
        title: "Private fixture",
        slug: `it-private-${randomUUID().slice(0, 8)}`,
        draft_definition: instantiateTemplate("blank", "en")
          .definition as unknown as NonNullable<Json>,
      })
      .select("id")
      .single();
    if (privateError) throw privateError;
    privateFormId = privateForm.id;
  });

  afterAll(async () => {
    if (formId) await admin.from("forms").delete().eq("id", formId);
    if (privateFormId)
      await admin.from("forms").delete().eq("id", privateFormId);
  });

  async function get(path: string, email: string) {
    return fetch(`${APP_URL}${path}`, {
      headers: { cookie: await sessionCookieHeader(email) },
      redirect: "manual",
    });
  }

  it("shared viewer can open the dashboard placeholder, read-only", async () => {
    const res = await get(`/en/forms/${formId}/dashboard`, DUMMY.viewer);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="dashboard-placeholder"');
    expect(html).not.toContain('data-testid="tab-builder"');
    expect(html).not.toContain('data-testid="tab-settings"');
  });

  it.each(["builder", "settings"])(
    "shared viewer gets 403 on %s",
    async (page) => {
      const res = await get(`/en/forms/${formId}/${page}`, DUMMY.viewer);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("Access denied");
    },
  );

  it("owner gets the builder", async () => {
    const res = await get(`/en/forms/${formId}/builder`, DUMMY.editor);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-testid="publish-button"');
  });

  it("a user without access gets 404, same as a missing form", async () => {
    for (const page of ["builder", "dashboard"]) {
      expect(
        (await get(`/en/forms/${privateFormId}/${page}`, DUMMY.editor)).status,
      ).toBe(404);
      expect(
        (await get(`/en/forms/${randomUUID()}/${page}`, DUMMY.editor)).status,
      ).toBe(404);
    }
  });
});
