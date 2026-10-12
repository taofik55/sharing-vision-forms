/**
 * Phase 2 integration tests: RLS on forms / form_members / form_versions,
 * sharing RPCs and publish_form versioning. Runs against .env.local (local stack).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instantiateTemplate } from "@/lib/forms/templates";
import type { Json } from "@/types/database";
import {
  DEFAULT_WORKSPACE_ID,
  DUMMY,
  DUMMY_PASSWORD,
  adminClient,
  profileId,
  signedInClient,
} from "./helpers";

const admin = adminClient();
const strangerEmail = `stranger-${randomUUID().slice(0, 8)}@formpulse.test`;
let strangerId: string;
let editorId: string;
let viewerId: string;
let formId: string;
let formSlug: string;

const definition = instantiateTemplate("customer_satisfaction", "en")
  .definition as unknown as NonNullable<Json>;

beforeAll(async () => {
  editorId = await profileId(DUMMY.editor);
  viewerId = await profileId(DUMMY.viewer);

  // A second editor who has no access to the fixture form (yet).
  const { data, error } = await admin.auth.admin.createUser({
    email: strangerEmail,
    password: DUMMY_PASSWORD,
    email_confirm: true,
    app_metadata: { role: "editor" },
  });
  if (error || !data.user) throw error;
  strangerId = data.user.id;
  await admin.from("profiles").update({ role: "editor" }).eq("id", strangerId);

  formSlug = `it-forms-${randomUUID().slice(0, 8)}`;
  const { data: form, error: formError } = await admin
    .from("forms")
    .insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: editorId,
      title: "Integration fixture",
      slug: formSlug,
      draft_definition: definition,
    })
    .select("id")
    .single();
  if (formError) throw formError;
  formId = form.id;
  await admin
    .from("form_members")
    .insert({ form_id: formId, user_id: viewerId, role: "viewer" });
});

afterAll(async () => {
  if (formId) await admin.from("forms").delete().eq("id", formId);
  if (strangerId) await admin.auth.admin.deleteUser(strangerId);
});

describe("editor (owner) creates forms", () => {
  it("can insert a form and read it back in the same request", async () => {
    const { client, userId } = await signedInClient(DUMMY.editor);
    const { data, error } = await client
      .from("forms")
      .insert({
        workspace_id: DEFAULT_WORKSPACE_ID,
        owner_id: userId,
        title: "Created via API",
        slug: `it-new-${randomUUID().slice(0, 8)}`,
        draft_definition: definition,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    await admin.from("forms").delete().eq("id", data!.id);
  });

  it("cannot create a form for someone else", async () => {
    const { client } = await signedInClient(DUMMY.editor);
    const { error } = await client.from("forms").insert({
      workspace_id: DEFAULT_WORKSPACE_ID,
      owner_id: viewerId,
      title: "Spoofed owner",
      slug: `it-spoof-${randomUUID().slice(0, 8)}`,
    });
    expect(error?.code).toBe("42501");
  });

  it("cannot set current_version_id or publish status directly", async () => {
    const { client } = await signedInClient(DUMMY.editor);
    const { error: statusError } = await client
      .from("forms")
      .update({ status: "published" })
      .eq("id", formId);
    expect(statusError?.code).toBe("23514"); // published requires a version

    const { error: versionError } = await client
      .from("forms")
      .update({ current_version_id: randomUUID() })
      .eq("id", formId);
    expect(versionError?.code).toBe("42501");
  });
});

describe("shared viewer", () => {
  it("can see the form and its members but not edit it", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const { data: forms } = await client
      .from("forms")
      .select("id")
      .eq("id", formId);
    expect(forms).toHaveLength(1);

    const { data: updated, error } = await client
      .from("forms")
      .update({ title: "hacked" })
      .eq("id", formId)
      .select("id");
    expect(error).toBeNull();
    expect(updated).toHaveLength(0);

    const { data: members } = await client.rpc("list_form_members", {
      p_form_id: formId,
    });
    expect(members?.map((m) => m.user_id)).toEqual([viewerId]);
  });

  it("sees the form in list_forms as read-only", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const { data } = await client.rpc("list_forms", {
      p_scope: "shared",
      p_limit: 100,
    });
    const row = data?.find((r) => r.id === formId);
    expect(row).toMatchObject({
      can_edit: false,
      access: "viewer",
      response_count: 0,
    });
  });

  it("cannot publish or share", async () => {
    const { client } = await signedInClient(DUMMY.viewer);
    const { error } = await client.rpc("publish_form", { p_form_id: formId });
    expect(error?.code).toBe("42501");
    const { error: shareError } = await client.rpc("add_form_member", {
      p_form_id: formId,
      p_email: strangerEmail,
      p_role: "viewer",
    });
    expect(shareError?.code).toBe("42501");
  });
});

describe("stranger (editor without access)", () => {
  it("cannot see, list, update or publish the form", async () => {
    const { client } = await signedInClient(strangerEmail);
    const { data: forms } = await client
      .from("forms")
      .select("id")
      .eq("id", formId);
    expect(forms).toHaveLength(0);

    const { data: listed } = await client.rpc("list_forms", { p_limit: 100 });
    expect(listed?.some((r) => r.id === formId)).toBe(false);

    const { data: updated } = await client
      .from("forms")
      .update({ title: "x" })
      .eq("id", formId)
      .select("id");
    expect(updated).toHaveLength(0);

    const { data: members } = await client.rpc("list_form_members", {
      p_form_id: formId,
    });
    expect(members).toEqual([]);

    const { error } = await client.rpc("publish_form", { p_form_id: formId });
    expect(error?.code).toBe("42501");

    const { data: versions } = await client
      .from("form_versions")
      .select("id")
      .eq("form_id", formId);
    expect(versions).toHaveLength(0);
  });

  it("can only learn whether a slug is taken", async () => {
    const { client } = await signedInClient(strangerEmail);
    const { data: taken } = await client.rpc("is_slug_available", {
      p_slug: formSlug,
    });
    expect(taken).toBe(false);
    const { data: free } = await client.rpc("is_slug_available", {
      p_slug: `free-${randomUUID()}`,
    });
    expect(free).toBe(true);
  });
});

describe("sharing as editor", () => {
  it("owner shares with the stranger as editor; they can edit but not manage", async () => {
    const owner = await signedInClient(DUMMY.editor);
    const { data: added, error } = await owner.client.rpc("add_form_member", {
      p_form_id: formId,
      p_email: strangerEmail.toUpperCase(),
      p_role: "editor",
    });
    expect(error).toBeNull();
    expect(added?.[0]).toMatchObject({ user_id: strangerId, role: "editor" });

    const { client } = await signedInClient(strangerEmail);
    const { data: updated } = await client
      .from("forms")
      .update({ description: "edited by shared editor" })
      .eq("id", formId)
      .select("id");
    expect(updated).toHaveLength(1);

    // Only the owner or an admin manages members / deletes.
    const { error: shareError } = await client.rpc("add_form_member", {
      p_form_id: formId,
      p_email: DUMMY.admin,
      p_role: "viewer",
    });
    expect(shareError?.code).toBe("42501");
    const { data: removed } = await client
      .from("form_members")
      .delete()
      .eq("form_id", formId)
      .select("user_id");
    expect(removed).toHaveLength(0);
    const { data: deleted } = await client
      .from("forms")
      .delete()
      .eq("id", formId)
      .select("id");
    expect(deleted).toHaveLength(0);
  });

  it("rejects unknown users and the owner", async () => {
    const owner = await signedInClient(DUMMY.editor);
    const unknown = await owner.client.rpc("add_form_member", {
      p_form_id: formId,
      p_email: "nobody@formpulse.test",
      p_role: "viewer",
    });
    expect(unknown.error?.code).toBe("P0002");
    const self = await owner.client.rpc("add_form_member", {
      p_form_id: formId,
      p_email: DUMMY.editor,
      p_role: "editor",
    });
    expect(self.error?.code).toBe("22023");
  });
});

describe("publish_form", () => {
  it("creates v1 then v2, and versions stay immutable", async () => {
    const { client } = await signedInClient(DUMMY.editor);

    const v1 = await client.rpc("publish_form", { p_form_id: formId }).single();
    expect(v1.error).toBeNull();
    expect(v1.data?.version_number).toBe(1);

    const { data: afterV1 } = await admin
      .from("forms")
      .select("status, current_version_id, updated_at")
      .eq("id", formId)
      .single();
    expect(afterV1).toMatchObject({
      status: "published",
      current_version_id: v1.data!.version_id,
    });

    // Stale optimistic-concurrency token is rejected.
    const stale = await client.rpc("publish_form", {
      p_form_id: formId,
      p_expected_updated_at: "2000-01-01T00:00:00Z",
    });
    expect(stale.error?.code).toBe("40001");

    // Edit the draft: remove a question. Published v1 keeps it.
    const draft = structuredClone(definition) as unknown as {
      sections: { questions: unknown[] }[];
    };
    draft.sections[1].questions.pop();
    await client
      .from("forms")
      .update({ draft_definition: draft as unknown as NonNullable<Json> })
      .eq("id", formId);

    // The shared editor (from the previous suite) can publish too.
    const shared = await signedInClient(strangerEmail);
    const v2 = await shared.client
      .rpc("publish_form", {
        p_form_id: formId,
        p_expected_updated_at: await currentUpdatedAt(),
      })
      .single();
    expect(v2.error).toBeNull();
    expect(v2.data?.version_number).toBe(2);

    const { data: versions } = await client
      .from("form_versions")
      .select("version_number, definition")
      .eq("form_id", formId)
      .order("version_number");
    expect(versions?.map((v) => v.version_number)).toEqual([1, 2]);
    const count = (v: { definition: unknown }) =>
      (v.definition as { sections: { questions: unknown[] }[] }).sections[1]
        .questions.length;
    expect(count(versions![0])).toBe(count(versions![1]) + 1);

    // Immutable: no client privileges, and the trigger blocks even the secret key.
    const update = await client
      .from("form_versions")
      .update({ definition: {} })
      .eq("form_id", formId);
    expect(update.error?.code).toBe("42501");
    const del = await client
      .from("form_versions")
      .delete()
      .eq("form_id", formId);
    expect(del.error?.code).toBe("42501");
    const adminUpdate = await admin
      .from("form_versions")
      .update({ definition: {} })
      .eq("id", v1.data!.version_id);
    expect(adminUpdate.error?.code).toBe("42501");
    const adminDelete = await admin
      .from("form_versions")
      .delete()
      .eq("id", v1.data!.version_id);
    expect(adminDelete.error?.code).toBe("42501");
  });

  it("list_forms reports the version and unpublished changes", async () => {
    const { client } = await signedInClient(DUMMY.editor);
    const row = async () =>
      (await client.rpc("list_forms", { p_limit: 100 })).data?.find(
        (r) => r.id === formId,
      );
    expect(await row()).toMatchObject({
      current_version_number: 2,
      has_unpublished_changes: false,
    });
    await client
      .from("forms")
      .update({ draft_definition: definition })
      .eq("id", formId);
    expect(await row()).toMatchObject({ has_unpublished_changes: true });
  });
});

async function currentUpdatedAt(): Promise<string> {
  const { data } = await admin
    .from("forms")
    .select("updated_at")
    .eq("id", formId)
    .single();
  return data!.updated_at;
}
