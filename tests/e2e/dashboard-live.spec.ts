import { devices, expect, test, type Page } from "@playwright/test";

const PASSWORD = "Password123!";

function widget(page: Page, title: string) {
  return page.locator('[data-testid="widget-question"]').filter({
    has: page.getByRole("heading", { level: 3, name: title, exact: true }),
  });
}

async function login(page: Page) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("editor@formpulse.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });
}

/** Editor creates + publishes a fresh Customer Satisfaction form; returns its public path. */
async function publishFreshForm(page: Page): Promise<string> {
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("template-customer_satisfaction").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("version-badge")).toHaveText("v1");
  await page.getByTestId("public-link-button").click();
  const publicPath = new URL(await page.getByTestId("public-url").inputValue())
    .pathname;
  await page.keyboard.press("Escape");
  return publicPath;
}

test("dashboard updates live when a response is submitted elsewhere", async ({
  page,
  browser,
}) => {
  await login(page);
  const publicPath = await publishFreshForm(page);

  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("live-badge")).toHaveAttribute(
    "data-status",
    "live",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("kpi-total")).toHaveText("0");
  const overall = widget(page, "Overall, how satisfied are you?");
  await expect(overall).toContainText("0 of 0 answered");

  // A respondent submits from a phone.
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const p = await phone.newPage();
  await p.goto(publicPath);
  await p.getByTestId("next-page").click({ timeout: 30_000 });
  const q = (title: string) =>
    p.locator("[data-question-key]").filter({ hasText: title });
  await q("Overall, how satisfied are you?").getByTitle("4 of 5 stars").click();
  await q("How likely are you to recommend us")
    .getByRole("radio", { name: "9", exact: true })
    .click();
  await q("May we contact you").getByRole("radio", { name: "No" }).click();
  await p.waitForTimeout(3100);
  await p.getByTestId("submit-form").click();
  await expect(p.getByTestId("thank-you")).toBeVisible();
  const submittedAt = Date.now();

  // Counter: realtime INSERT bumps it immediately; charts follow the debounced refetch.
  await expect(page.getByTestId("kpi-total")).toHaveText("1", {
    timeout: 5_000,
  });
  const counterMs = Date.now() - submittedAt;
  await expect(overall).toContainText("1 of 1 answered", { timeout: 5_000 });
  await expect(overall.getByTestId("widget-insight")).toContainText(
    "Average rating 4 of 5",
  );
  console.log(
    `live counter after ${counterMs} ms, chart after ${Date.now() - submittedAt} ms`,
  );
  await phone.close();

  // Responses tab: the row, its drawer, and deleting it (owner).
  await page.getByTestId("tab-responses").click();
  await expect(page.getByTestId("responses-count")).toHaveText("1 response", {
    timeout: 30_000,
  });
  await page.getByTestId("response-row").first().click();
  const drawer = page.getByTestId("response-drawer");
  await expect(drawer).toContainText("Overall, how satisfied are you?");
  await expect(drawer).toContainText("4");
  await drawer.getByTestId("delete-response").click();
  await page.getByRole("button", { name: "Delete response" }).last().click();
  await expect(page.getByText("Response deleted.")).toBeVisible();
  await expect(page.getByTestId("responses-count")).toHaveText("0 responses");
});

test("editor customizes the dashboard and it survives a reload; viewer has no edit controls", async ({
  page,
  browser,
}) => {
  await login(page);
  await publishFreshForm(page);
  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });

  await page.getByTestId("edit-dashboard").click();
  const channel = widget(page, "How did you hear about us?");
  await channel.getByTestId("widget-menu").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("widget-rename-input").fill("Acquisition channel");
  await page.getByTestId("widget-edit-save").click();
  const renamed = widget(page, "Acquisition channel");
  await renamed.getByTestId("widget-menu").click();
  await page.getByRole("menuitem", { name: "Chart type" }).hover();
  await page.getByRole("menuitemradio", { name: "Horizontal bar" }).click();
  const products = widget(page, "Which products did you use?");
  await products.getByTestId("widget-menu").click();
  await page.getByRole("menuitem", { name: "Hide" }).click();
  await expect(page.getByTestId("dashboard-save")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 10_000 },
  );
  await page.getByTestId("edit-dashboard").click();

  await page.reload();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(widget(page, "Acquisition channel")).toHaveCount(1);
  await expect(widget(page, "Which products did you use?")).toHaveCount(0);
  const url = page.url();

  // Republish with a new question: it gets a widget in a "New questions" group.
  await page.getByTestId("tab-builder").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
    { timeout: 45_000 },
  );
  await page.getByTestId("palette-rating").click();
  await page.locator("#q-title").fill("How was the music?");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
  );
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("version-badge")).toHaveText("v2");
  await page.goto(url);
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("heading", { name: "New questions" }),
  ).toBeVisible();
  await expect(widget(page, "How was the music?")).toHaveCount(1);
  await expect(widget(page, "Acquisition channel")).toHaveCount(1);
  await expect(widget(page, "Which products did you use?")).toHaveCount(0);

  // The dummy viewer gets read access to this form and sees no edit controls.
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("member-email").fill("viewer@formpulse.test");
  await page.getByTestId("member-add").click();
  await expect(page.getByTestId("member-viewer@formpulse.test")).toBeVisible();

  const viewerContext = await browser.newContext();
  const v = await viewerContext.newPage();
  await v.goto("/en/login");
  await v.getByLabel("Email").fill("viewer@formpulse.test");
  await v.getByLabel("Password").fill(PASSWORD);
  await v.getByRole("button", { name: "Sign in" }).click();
  await expect(v).toHaveURL(/\/en$/, { timeout: 30_000 });
  await v.goto(url);
  await expect(v.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(widget(v, "Acquisition channel")).toHaveCount(1);
  await expect(v.getByTestId("edit-dashboard")).toHaveCount(0);
  await viewerContext.close();
});
