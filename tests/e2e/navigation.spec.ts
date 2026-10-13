import { expect, test, type Page } from "@playwright/test";

// DUMMY accounts created by `pnpm seed`.
const PASSWORD = "Password123!";

const ACCOUNTS = [
  {
    role: "admin",
    email: "admin@formpulse.test",
    visible: ["home", "forms", "users", "demoTools"],
    hidden: [],
    canCreate: true,
  },
  {
    role: "editor",
    email: "editor@formpulse.test",
    visible: ["home", "forms"],
    hidden: ["users", "demoTools"],
    canCreate: true,
  },
  {
    role: "viewer",
    email: "viewer@formpulse.test",
    visible: ["home", "forms"],
    hidden: ["users", "demoTools"],
    canCreate: false,
  },
] as const;

async function login(page: Page, email: string) {
  await page.goto("/id/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/id$/, { timeout: 30_000 });
}

for (const account of ACCOUNTS) {
  test(`${account.role} sees role-aware navigation`, async ({ page }) => {
    await login(page, account.email);

    await expect(page.getByTestId("role-badge")).toHaveAttribute(
      "data-role",
      account.role,
    );
    for (const key of account.visible) {
      await expect(page.getByTestId(`nav-${key}`)).toBeVisible();
    }
    for (const key of account.hidden) {
      await expect(page.getByTestId(`nav-${key}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("create-form")).toHaveCount(
      account.canCreate ? 1 : 0,
    );

    const response = await page.goto("/id/admin/users");
    if (account.role === "admin") {
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("users-table")).toBeVisible();
    } else {
      expect(response?.status()).toBe(403);
      await expect(
        page.getByRole("heading", { name: "Akses ditolak" }),
      ).toBeVisible();
    }
  });
}

test("language switch keeps the current page", async ({ page }) => {
  // Switching remounts the [locale] layout; nothing may log an error
  // (regression: React warned about the theme script tag).
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await login(page, "viewer@formpulse.test");
  await expect(page).toHaveTitle(/Sharing Vision Form App/);
  await page.getByTestId("nav-forms").click();
  await expect(page).toHaveURL(/\/id\/forms$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Formulir" }),
  ).toBeVisible();

  await page.getByTestId("language-switcher").click();
  await page.getByRole("menuitem", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en\/forms$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Forms" }),
  ).toBeVisible();

  await page.getByTestId("language-switcher").click();
  await page.getByRole("menuitem", { name: "Bahasa Indonesia" }).click();
  await expect(page).toHaveURL(/\/id\/forms$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Formulir" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("wrong password shows a friendly error", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("viewer@formpulse.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toHaveText(
    "Incorrect email or password.",
  );
});
