/**
 * HTTP-level route guard checks. Needs the app running at APP_URL
 * (default http://localhost:3000, e.g. `pnpm dev`). Skipped with a notice
 * otherwise; Playwright (`pnpm e2e`) covers the same paths with its own server.
 */
import { describe, expect, it } from "vitest";
import { DUMMY, sessionCookieHeader } from "./helpers";

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
    `[admin-route.test] ${APP_URL} not reachable: skipping HTTP guard tests.`,
  );

describe.skipIf(!up)("/admin/users guard (HTTP)", () => {
  async function get(path: string, email?: string) {
    const headers: Record<string, string> = {};
    if (email) headers.cookie = await sessionCookieHeader(email);
    return fetch(`${APP_URL}${path}`, { headers, redirect: "manual" });
  }

  it("redirects anonymous users to login", async () => {
    const res = await get("/id/admin/users");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/id/login");
  });

  it.each([DUMMY.editor, DUMMY.viewer])("returns 403 for %s", async (email) => {
    const res = await get("/en/admin/users", email);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Access denied");
  });

  it("returns 200 for admin", async () => {
    const res = await get("/en/admin/users", DUMMY.admin);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(DUMMY.viewer);
  });
});
