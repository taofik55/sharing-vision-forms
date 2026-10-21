import { describe, expect, it } from "vitest";
import {
  canCreateForms,
  getNavItems,
  isAppRole,
  isNavItemActive,
} from "@/lib/auth/roles";

describe("getNavItems", () => {
  const keys = (role: Parameters<typeof getNavItems>[0]) =>
    getNavItems(role).map((i) => i.key);

  it("gives admins the admin section", () => {
    expect(keys("admin")).toEqual([
      "home",
      "forms",
      "interviews",
      "users",
      "demoTools",
    ]);
  });

  it.each(["editor", "viewer"] as const)(
    "hides admin items from %s",
    (role) => {
      expect(keys(role)).toEqual(["home", "forms", "interviews"]);
    },
  );

  it("gives surveyors interviews only", () => {
    expect(keys("surveyor")).toEqual(["interviews"]);
  });
});

describe("canCreateForms", () => {
  it("allows admin and editor, not viewer", () => {
    expect(canCreateForms("admin")).toBe(true);
    expect(canCreateForms("editor")).toBe(true);
    expect(canCreateForms("viewer")).toBe(false);
    expect(canCreateForms("surveyor")).toBe(false);
  });
});

describe("isAppRole", () => {
  it("validates role strings", () => {
    expect(isAppRole("editor")).toBe(true);
    expect(isAppRole("owner")).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });
});

describe("isNavItemActive", () => {
  it("matches home exactly and sections by prefix", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/", "/forms")).toBe(false);
    expect(isNavItemActive("/forms", "/forms/abc/builder")).toBe(true);
    expect(isNavItemActive("/forms", "/formsx")).toBe(false);
  });
});
