import { describe, expect, it } from "vitest";
import { isLoginErrorKey, mapAuthError } from "@/lib/auth/errors";

describe("mapAuthError", () => {
  it.each([
    [{ code: "invalid_credentials", status: 400 }, "invalidCredentials"],
    [{ code: "user_banned", status: 400 }, "inactive"],
    [{ code: "email_not_confirmed", status: 400 }, "emailNotConfirmed"],
    [{ code: "over_request_rate_limit", status: 429 }, "rateLimited"],
    [{ status: 429 }, "rateLimited"],
    [{ status: 400 }, "invalidCredentials"],
    [{ code: "unexpected_failure", status: 500 }, "generic"],
    [null, "generic"],
  ] as const)("maps %j to %s", (error, key) => {
    expect(mapAuthError(error)).toBe(key);
  });
});

describe("isLoginErrorKey", () => {
  it("accepts known keys only", () => {
    expect(isLoginErrorKey("inactive")).toBe(true);
    expect(isLoginErrorKey("<script>")).toBe(false);
    expect(isLoginErrorKey(undefined)).toBe(false);
  });
});
