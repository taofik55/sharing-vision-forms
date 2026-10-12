import { expect, test, type Page } from "@playwright/test";

// Creates throwaway users named e2e-*@formpulse.test (reset with `pnpm db:reset && pnpm seed`).
const PASSWORD = "Password123!";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("admin creates, promotes and deactivates a user", async ({
  page,
  browser,
}) => {
  const email = `e2e-${Date.now()}@formpulse.test`;

  await login(page, "admin@formpulse.test");
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/admin/users");

  // Create
  await page.getByTestId("create-user").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("E2E User");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Initial password").fill("short");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    dialog.getByText("Password must be at least 8 characters."),
  ).toBeVisible();
  await dialog.getByLabel("Initial password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("User created.")).toBeVisible();

  const row = page.getByTestId(`user-row-${email}`);
  await expect(row).toContainText("Viewer");

  // Admin cannot change their own row
  const selfRow = page.getByTestId("user-row-admin@formpulse.test");
  await expect(selfRow.getByRole("combobox")).toBeDisabled();
  await expect(
    selfRow.getByRole("button", { name: "Deactivate" }),
  ).toBeDisabled();

  // Promote to editor
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: "Editor" }).click();
  await expect(page.getByText("Role updated.")).toBeVisible();
  await expect(row.getByRole("combobox")).toContainText("Editor");

  // The new user signs in in a separate browser context
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, email);
  await expect(other).toHaveURL(/\/en$/);
  await expect(other.getByTestId("role-badge")).toHaveAttribute(
    "data-role",
    "editor",
  );

  // Deactivate: the signed-in user is kicked out on the next request
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("User deactivated.")).toBeVisible();
  await expect(row).toContainText("Inactive");

  await other.reload();
  await expect(other).toHaveURL(/\/en\/login\?error=inactive$/);
  await expect(other.getByTestId("login-error")).toContainText("inactive");

  // ...and cannot sign in again
  await login(other, email);
  await expect(other.getByTestId("login-error")).toContainText("inactive");
  await otherContext.close();
});
