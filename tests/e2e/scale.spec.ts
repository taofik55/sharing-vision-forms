import { expect, test } from "@playwright/test";

// /admin/demo/scale (needs ENABLE_DEMO_TOOLS=true in .env.local).
test("scale page: generate, live simulator, performance panel, clear", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("admin@formpulse.test");
  await page.getByLabel("Password").fill("Password123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });

  await page.goto("/en/admin/demo/scale");
  await expect(page.getByTestId("demo-banner")).toBeVisible({
    timeout: 45_000,
  });
  const setup = page.getByTestId("setup-scale-form");
  if (await setup.isVisible()) {
    await setup.click();
  }
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });

  // Start from an empty demo form.
  const total = page.getByTestId("scale-total");
  if ((await total.textContent()) !== "0") {
    await page.getByTestId("clear-demo").click();
    await page.getByRole("button", { name: "Clear demo data" }).last().click();
    await expect(total).toHaveText("0", { timeout: 60_000 });
  }

  // Generate 1,000 responses over 7 days (database-side, in one chunk).
  await page.getByTestId("preset-1000").click();
  await page.getByRole("radio", { name: "7 days" }).click();
  await page.getByTestId("generate-demo").click();
  await expect(page.getByTestId("demo-job")).toContainText("Done in", {
    timeout: 60_000,
  });
  await expect(total).toHaveText("1,000", { timeout: 30_000 });
  await expect(page.getByTestId("kpi-total")).toHaveText("1,000");

  // Performance panel reports the real dashboard calls.
  const bundlePanel = page.getByTestId("perf-dashboard_bundle");
  await expect(bundlePanel).toContainText("Round trip");
  await expect(bundlePanel).toContainText("KB");

  // Live simulator: 5 responses per second for a few seconds.
  await page.getByTestId("rate-5").click();
  await page.getByTestId("simulator-toggle").click();
  await expect(page.getByTestId("simulator-sent")).toContainText(
    /1[05] responses sent|[2-9]\d responses sent/,
    {
      timeout: 15_000,
    },
  );
  await page.getByTestId("simulator-toggle").click();
  // The dashboard counter moves with the simulator (Realtime, batched).
  await expect
    .poll(
      async () =>
        Number(
          (await page.getByTestId("kpi-total").textContent())!.replace(
            /,/g,
            "",
          ),
        ),
      {
        timeout: 15_000,
      },
    )
    .toBeGreaterThanOrEqual(1010);
  await expect(page.getByTestId("perf-render")).toContainText("Last");

  // Demo forms stay out of the normal forms list.
  await page.goto("/en/forms?q=Scale%20test");
  await expect(page.getByText("Scale test (Demo)")).toHaveCount(0);
  await page.goto("/en/forms?q=Scale%20test&demo=1");
  await expect(page.getByText("Scale test (Demo)").first()).toBeVisible();

  // Clear deletes only the demo rows.
  await page.goto("/en/admin/demo/scale");
  await page.getByTestId("clear-demo").click();
  await page.getByRole("button", { name: "Clear demo data" }).last().click();
  await expect(page.getByTestId("scale-total")).toHaveText("0", {
    timeout: 60_000,
  });
});
