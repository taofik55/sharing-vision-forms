/**
 * RLS / permission integration tests. Run against the Supabase project in
 * .env.local — by default the LOCAL stack (`pnpm db:start && pnpm db:reset && pnpm seed`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  PUBLIC_TABLES,
  adminClient,
  anonClient,
  profileId,
  signedInClient,
} from "./helpers";

const admin = adminClient();
let formId: string;
let versionId: string;
let editorId: string;
let viewerId: string;

beforeAll(async () => {
  editorId = await profileId(DUMMY.editor);
  viewerId = await profileId(DUMMY.viewer);

  // Fixture: a form owned by the editor, shared with the viewer as *editor*
  // member (proves the app-level viewer role still cannot write).
  const { data: form, error } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: editorId,
      title: "RLS fixture",
      slug: `rls-${randomUUID().slice(0, 8)}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  formId = form.id;

  const { error: memberError } = await admin
    .from("form_members")
    .insert({ form_id: formId, user_id: viewerId, role: "editor" });
  if (memberError) throw memberError;

  const { data: version, error: versionError } = await admin
    .from("form_versions")
    .insert({
      form_id: formId,
      version_number: 1,
      definition: {},
      published_by: editorId,
    })
    .select("id")
    .single();
  if (versionError) throw versionError;
  versionId = version.id;
});

afterAll(async () => {
  // Deleting the form must cascade through the immutable form_versions table.
  if (formId) {
    const { error } = await admin.from("forms").delete().eq("id", formId);
    expect(error).toBeNull();
    const { count } = await admin
      .from("form_versions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId);
    expect(count).toBe(0);
  }
});

describe("anon (publishable key, no session)", () => {
  it.each(PUBLIC_TABLES)("cannot select from %s", async (table) => {
    const { data, error } = await anonClient().from(table).select("*").limit(1);
    expect(data ?? []).toHaveLength(0);
    expect(error?.code).toBe("42501"); // permission denied: no grants at all
  });

  it("cannot call permission helpers", async () => {
    const { error } = await anonClient().rpc("is_admin");
    expect(error).not.toBeNull();
  });
});

describe("viewer", () => {
  it("can read a form shared with them", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const { data, error } = await client
      .from("forms")
      .select("id, title")
      .eq("id", formId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("cannot update a form, even as an editor member", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const { data, error } = await client
      .from("forms")
      .update({ title: "hacked" })
      .eq("id", formId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0); // RLS filtered the row out

    const { data: after } = await admin
      .from("forms")
      .select("title")
      .eq("id", formId)
      .single();
    expect(after?.title).toBe("RLS fixture");
  });

  it("cannot create forms", async () => {
    const { client, userId } = await signedInClient(DUMMY.viewer);
    const { error } = await client.from("forms").insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: userId,
      title: "nope",
      slug: `nope-${randomUUID().slice(0, 8)}`,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("editor", () => {
  it("can update own form but cannot reassign its owner", async () => {
    const { client } = await signedInClient(DUMMY.editor);
    const { data, error } = await client
      .from("forms")
      .update({ description: "edited by owner" })
      .eq("id", formId)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { error: ownerError } = await client
      .from("forms")
      .update({ owner_id: viewerId })
      .eq("id", formId);
    expect(ownerError?.code).toBe("42501");
  });

  it("cannot read other users' profiles", async () => {
    const { client, userId } = await signedInClient(DUMMY.editor);
    const { data } = await client.from("profiles").select("id");
    expect(data?.map((p) => p.id)).toEqual([userId]);
  });

  it("cannot insert form versions directly", async () => {
    const { client } = await signedInClient(DUMMY.editor);
    const { error } = await client
      .from("form_versions")
      .insert({ form_id: formId, version_number: 99, definition: {} });
    expect(error?.code).toBe("42501");
  });
});

describe("profiles self-service", () => {
  it.each([DUMMY.viewer, DUMMY.editor])(
    "%s cannot change own role",
    async (email) => {
      const { client, userId } = await signedInClient(email);
      const { error } = await client
        .from("profiles")
        .update({ role: "admin" })
        .eq("id", userId);
      expect(error?.code).toBe("42501");

      const { data } = await admin
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      expect(data?.role).not.toBe("admin");
    },
  );

  it("a user cannot deactivate or re-email themselves", async () => {
    const { client, userId } = await signedInClient(DUMMY.viewer);
    const { error: activeError } = await client
      .from("profiles")
      .update({ is_active: false })
      .eq("id", userId);
    expect(activeError?.code).toBe("42501");

    const { error: emailError } = await client
      .from("profiles")
      .update({ email: "x@y.z" })
      .eq("id", userId);
    expect(emailError?.code).toBe("42501"); // no column grant
  });

  it("a user can update own full_name and locale", async () => {
    const { client, userId } = await signedInClient(DUMMY.viewer);
    const { data, error } = await client
      .from("profiles")
      .update({ locale: "en", full_name: "Dummy Viewer" })
      .eq("id", userId)
      .select("locale");
    expect(error).toBeNull();
    expect(data?.[0]?.locale).toBe("en");
    await client.from("profiles").update({ locale: "id" }).eq("id", userId);
  });

  it("an admin cannot demote or deactivate themselves", async () => {
    const { client, userId } = await signedInClient(DUMMY.admin);
    const { error } = await client
      .from("profiles")
      .update({ role: "editor" })
      .eq("id", userId);
    expect(error?.code).toBe("42501");
    const { error: deactivateError } = await client
      .from("profiles")
      .update({ is_active: false })
      .eq("id", userId);
    expect(deactivateError?.code).toBe("42501");
  });

  it("an admin can read all workspace profiles", async () => {
    const { client } = await signedInClient(DUMMY.admin);
    const { data } = await client.from("profiles").select("email");
    expect(data?.map((p) => p.email)).toEqual(
      expect.arrayContaining([DUMMY.admin, DUMMY.editor, DUMMY.viewer]),
    );
  });
});

describe("immutability and private tables", () => {
  it("form_versions rows cannot be updated, even with the secret key", async () => {
    const { error } = await admin
      .from("form_versions")
      .update({ definition: { tampered: true } })
      .eq("id", versionId);
    expect(error?.code).toBe("42501");
  });

  it("form_versions rows cannot be deleted while the form exists", async () => {
    const { error } = await admin
      .from("form_versions")
      .delete()
      .eq("id", versionId);
    expect(error?.code).toBe("42501");
  });

  it.each(["response_drafts", "rate_limits"] as const)(
    "signed-in users have no access to %s",
    async (table) => {
      const { client } = await signedInClient(DUMMY.admin);
      const { error } = await client.from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
    },
  );
});
