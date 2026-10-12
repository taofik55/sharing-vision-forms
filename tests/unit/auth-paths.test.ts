import { describe, expect, it } from "vitest";
import { isPublicPath, safeNextPath, splitLocale } from "@/lib/auth/paths";

describe("splitLocale", () => {
  it("extracts a supported locale prefix", () => {
    expect(splitLocale("/en/forms/1")).toEqual({
      locale: "en",
      path: "/forms/1",
    });
    expect(splitLocale("/id")).toEqual({ locale: "id", path: "/" });
  });

  it("returns null locale for unprefixed or unknown prefixes", () => {
    expect(splitLocale("/forms")).toEqual({ locale: null, path: "/forms" });
    expect(splitLocale("/fr/forms")).toEqual({
      locale: null,
      path: "/fr/forms",
    });
    expect(splitLocale("/")).toEqual({ locale: null, path: "/" });
  });
});

describe("isPublicPath", () => {
  it.each(["/login", "/f/abc", "/d/token123"])("%s is public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(["/", "/forms", "/admin/users", "/f", "/dashboard", "/loginx"])(
    "%s requires auth",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/forms?page=2")).toBe("/forms?page=2");
  });

  it.each([
    undefined,
    "",
    "forms",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/foo\nbar",
    42,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("uses the provided fallback", () => {
    expect(safeNextPath("//x", "/home")).toBe("/home");
  });
});
