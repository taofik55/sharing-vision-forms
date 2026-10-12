/**
 * Idempotent seed: default workspace + three DUMMY accounts.
 *
 *   pnpm seed                  # local stack (default)
 *   pnpm seed --allow-remote   # a hosted Supabase project (think twice)
 *
 * !!! DUMMY ACCOUNTS — LOCAL DEVELOPMENT AND DEMOS ONLY !!!
 * The passwords below are public. Never run this against production data,
 * or deactivate/delete these accounts afterwards.
 *
 * Runs with `--conditions=react-server` so it can import the server-only
 * admin client (the only module allowed to read SUPABASE_SECRET_KEY).
 */
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { AppRole } from "../src/lib/auth/roles";

const DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_WORKSPACE_NAME = "Default workspace";
const DUMMY_PASSWORD = "Password123!";

const DUMMY_USERS: { email: string; fullName: string; role: AppRole }[] = [
  { email: "admin@formpulse.test", fullName: "Dummy Admin", role: "admin" },
  { email: "editor@formpulse.test", fullName: "Dummy Editor", role: "editor" },
  { email: "viewer@formpulse.test", fullName: "Dummy Viewer", role: "viewer" },
];

function assertTarget() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);
  if (!isLocal && !process.argv.includes("--allow-remote")) {
    console.error(
      `Refusing to seed DUMMY accounts into a non-local project (${url}).\n` +
        "Re-run with `pnpm seed --allow-remote` if this is a dev/demo project.",
    );
    process.exit(1);
  }
  return url;
}

async function findUserByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<User | null> {
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  const url = assertTarget();
  const supabase = createAdminClient();

  const { error: wsError } = await supabase
    .from("workspaces")
    .upsert(
      { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (wsError) throw wsError;

  const summary: {
    email: string;
    role: AppRole;
    status: "created" | "updated";
  }[] = [];

  for (const dummy of DUMMY_USERS) {
    const attributes = {
      password: DUMMY_PASSWORD,
      email_confirm: true,
      user_metadata: { role: dummy.role, full_name: dummy.fullName },
      app_metadata: { role: dummy.role },
    };

    let userId: string;
    let status: "created" | "updated";
    const existing = await findUserByEmail(supabase, dummy.email);
    if (existing) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, {
        ...attributes,
        ban_duration: "none",
      });
      if (error) throw error;
      userId = existing.id;
      status = "updated";
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: dummy.email,
        ...attributes,
      });
      if (error || !data.user)
        throw error ?? new Error(`createUser failed for ${dummy.email}`);
      userId = data.user.id;
      status = "created";
    }

    // The auth trigger creates profiles as 'viewer'; enforce the intended state.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        role: dummy.role,
        full_name: dummy.fullName,
        is_active: true,
        workspace_id: DEFAULT_WORKSPACE_ID,
      })
      .eq("id", userId);
    if (profileError) throw profileError;

    summary.push({ email: dummy.email, role: dummy.role, status });
  }

  console.log(`\nSeeded ${url}`);
  console.log(
    `Workspace: ${DEFAULT_WORKSPACE_NAME} (${DEFAULT_WORKSPACE_ID})\n`,
  );
  console.log("DUMMY accounts (development only, shared password):");
  console.table(summary.map((s) => ({ ...s, password: DUMMY_PASSWORD })));
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
