import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Accessibility (axe, WCAG 2.1 A/AA) and small-screen checks on the main
// surfaces. Uses the seeded demo form (`pnpm seed:demo`).
const PASSWORD = "Password123!";
const DEMO_SLUG = "demo-customer-satisfaction";

async function login(page: Page, email = "editor@formpulse.test") {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });
}

async function demoFormId(page: Page): Promise<string> {
  await page.goto(
    "/en/forms?demo=1&q=Customer%20Satisfaction%20Survey%20(Demo)",
  );
  const link = page
    .getByRole("link", { name: "Customer Satisfaction Survey (Demo)" })
    .first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  return (await link.getAttribute("href"))!.match(/forms\/([0-9a-f-]{36})/)![1];
}

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 3)
        .join(" | ")}`,
  );
  expect(summary).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("accessibility", () => {
  test("login", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("public form", async ({ page }) => {
    await page.goto(`/en/f/${DEMO_SLUG}`);
    await expect(page.getByTestId("next-page")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoViolations(page);
  });

  test("builder and dashboard", async ({ page }) => {
    await login(page);
    const id = await demoFormId(page);
    await page.goto(`/en/forms/${id}/builder`);
    await expect(page.getByTestId("publish-button")).toBeVisible({
      timeout: 45_000,
    });
    await expectNoViolations(page);

    await page.goto(`/en/forms/${id}/dashboard`);
    await expect(page.getByTestId("kpi-total")).toBeVisible({
      timeout: 45_000,
    });
    await expectNoViolations(page);
  });
});

test.describe("360 px wide screens", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("login, public form, forms list and dashboard fit without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto("/en/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(`/en/f/${DEMO_SLUG}`);
    await expect(page.getByTestId("next-page")).toBeVisible({
      timeout: 30_000,
    });
    await expectNoHorizontalScroll(page);

    await login(page);
    const id = await demoFormId(page);
    await expectNoHorizontalScroll(page);
    await page.goto(`/en/forms/${id}/dashboard`);
    await expect(page.getByTestId("kpi-total")).toBeVisible({
      timeout: 45_000,
    });
    await expectNoHorizontalScroll(page);
  });
});

test("print stylesheet hides the app shell and controls", async ({ page }) => {
  await login(page);
  const id = await demoFormId(page);
  await page.goto(`/en/forms/${id}/dashboard`);
  await expect(page.getByTestId("kpi-total")).toBeVisible({ timeout: 45_000 });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByTestId("filter-bar")).toBeHidden();
  await expect(page.getByTestId("print-dashboard")).toBeHidden();
  await expect(page.getByTestId("kpi-total")).toBeVisible();
});
