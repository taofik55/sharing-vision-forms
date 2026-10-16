import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "Password123!";

async function login(page: Page, email = "editor@formpulse.test") {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });
}

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

async function respond(browser: Browser, publicPath: string, nps: string) {
  const context = await browser.newContext();
  const p = await context.newPage();
  await p.goto(publicPath);
  await p.getByTestId("next-page").click({ timeout: 30_000 });
  const q = (title: string) =>
    p.locator("[data-question-key]").filter({ hasText: title });
  await q("Overall, how satisfied are you?").getByTitle("4 of 5 stars").click();
  await q("How likely are you to recommend us")
    .getByRole("radio", { name: nps, exact: true })
    .click();
  await q("May we contact you").getByRole("radio", { name: "No" }).click();
  await p.waitForTimeout(3100);
  await p.getByTestId("submit-form").click();
  await expect(p.getByTestId("thank-you")).toBeVisible();
  await context.close();
}

/** dnd-kit listens to pointer events: drag with real mouse moves. */
async function drag(page: Page, from: string, slot: string) {
  const source = page
    .getByTestId("builder-column")
    .filter({ hasText: from })
    .locator("button")
    .first();
  await source.scrollIntoViewIfNeeded();
  const a = (await source.boundingBox())!;
  const b = (await page.getByTestId(slot).boundingBox())!;
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("editor builds a custom chart, edits it, and a viewer sees it read-only", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await login(page);
  const publicPath = await publishFreshForm(page);
  await respond(browser, publicPath, "9");
  await respond(browser, publicPath, "10");

  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  const url = page.url();

  // Open the builder: an empty chart offers quick starts.
  await page.getByTestId("open-chart-builder").click();
  const builder = page.getByTestId("chart-builder");
  await expect(builder).toBeVisible();
  await expect(builder.getByTestId("quick-starts")).toBeVisible();

  // Column chart: click "Submitted at" (fills the grouping slot), drag the
  // NPS question onto the value slot, then switch the calculation to NPS.
  await builder.getByTestId("chart-type-column").click();
  await builder
    .getByTestId("builder-column")
    .filter({ hasText: "Submitted at" })
    .locator("button")
    .first()
    .click();
  await expect(builder.getByTestId("slot-dim0")).toContainText("Submitted at");
  await expect(builder.getByTestId("slot-dim0")).toContainText("Day");
  await drag(page, "How likely are you to recommend us", "slot-metrics");
  const metrics = builder.getByTestId("slot-metrics");
  await expect(metrics).toContainText("Average · How likely");
  await metrics.getByTestId("chip-settings").click();
  await page.getByTestId("agg-select").click();
  await page.getByRole("option", { name: "NPS", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(metrics).toContainText("NPS · How likely");

  // Live preview renders the aggregated chart.
  const preview = builder.getByTestId("builder-preview");
  await expect(preview.locator("svg.recharts-surface").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(builder).toContainText("From 2 responses");

  await builder.getByTestId("builder-title").fill("NPS per day");
  await builder.getByTestId("builder-save").click();
  await expect(builder).toHaveCount(0);

  const chart = page.locator('[data-testid="widget-custom"]').filter({
    has: page.getByRole("heading", { level: 3, name: "NPS per day" }),
  });
  await expect(chart).toBeVisible();
  await expect(page.getByTestId("dashboard-save")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 10_000 },
  );

  // Survives a reload; the data table shows the NPS (both promoters = 100).
  await page.reload();
  await expect(chart).toBeVisible({ timeout: 45_000 });
  await chart.getByTestId("toggle-table").click();
  await expect(chart.locator("table")).toContainText("100");
  await chart.getByTestId("toggle-table").click();

  // Edit: switch to a KPI number.
  await chart.getByTestId("edit-chart").click();
  await expect(builder.getByTestId("builder-title")).toHaveValue("NPS per day");
  await builder.getByTestId("chart-type-kpi").click();
  await expect(builder.getByTestId("slot-dim0")).toHaveCount(0);
  await builder.getByTestId("builder-save").click();
  await expect(chart.getByTestId("kpi-value")).toHaveText("100", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("dashboard-save")).toHaveAttribute(
    "data-state",
    "saved",
    { timeout: 10_000 },
  );

  // A question chart opens in the builder as a new chart.
  await page.getByTestId("edit-dashboard").click();
  await page
    .locator('[data-testid="widget-question"]')
    .filter({
      has: page.getByRole("heading", {
        level: 3,
        name: "How did you hear about us?",
      }),
    })
    .getByTestId("widget-menu")
    .click();
  await page.getByTestId("open-in-builder").click();
  await expect(builder.getByTestId("slot-dim0")).toContainText(
    "How did you hear about us?",
  );
  await builder.getByRole("button", { name: "Cancel" }).click();
  await expect(builder).toHaveCount(0);
  await page.getByTestId("edit-dashboard").click();

  // The viewer sees the chart without builder controls.
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("member-email").fill("viewer@formpulse.test");
  await page.getByTestId("member-add").click();
  await expect(page.getByTestId("member-viewer@formpulse.test")).toBeVisible();
  const viewerContext = await browser.newContext();
  const v = await viewerContext.newPage();
  await login(v, "viewer@formpulse.test");
  await v.goto(url);
  await expect(v.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(v.getByTestId("widget-custom")).toHaveCount(1);
  await expect(v.getByTestId("kpi-value")).toHaveText("100");
  await expect(v.getByTestId("open-chart-builder")).toHaveCount(0);
  await expect(v.getByTestId("edit-chart")).toHaveCount(0);
  await viewerContext.close();
});
