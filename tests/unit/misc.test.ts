import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import { initials } from "@/lib/format/initials";
import { createUserSchema } from "@/lib/users/schema";

function flattenKeys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flattenKeys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("messages", () => {
  it("en and id define exactly the same keys", () => {
    expect(flattenKeys(id).sort()).toEqual(flattenKeys(en).sort());
  });

  it("has no empty strings", () => {
    for (const messages of [en, id]) {
      const empty = flattenKeys(messages).filter((key) => {
        const value = key
          .split(".")
          .reduce<unknown>(
            (acc, k) => (acc as Record<string, unknown>)[k],
            messages,
          );
        return typeof value === "string" && value.trim() === "";
      });
      expect(empty).toEqual([]);
    }
  });
});

describe("initials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["dummy admin user", "DA"],
    ["admin@formpulse.test", "A"],
    ["  ", "?"],
  ])("%s -> %s", (input, expected) => {
    expect(initials(input)).toBe(expected);
  });
});

describe("createUserSchema", () => {
  const valid = {
    email: " New@Example.COM ",
    fullName: " New User ",
    role: "editor",
    password: "longenough",
  };

  it("normalizes email and trims the name", () => {
    const parsed = createUserSchema.parse(valid);
    expect(parsed.email).toBe("new@example.com");
    expect(parsed.fullName).toBe("New User");
  });

  it.each([
    { email: "nope" },
    { fullName: "" },
    { role: "owner" },
    { password: "short" },
  ])("rejects %j", (override) => {
    expect(createUserSchema.safeParse({ ...valid, ...override }).success).toBe(
      false,
    );
  });
});
