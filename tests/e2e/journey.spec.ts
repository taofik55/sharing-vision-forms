import {
  devices,
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";

const PASSWORD = "Password123!";

async function login(page: Page, email: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });
}

/** Minimal RFC 4180 reader (quoted fields, "" escapes, CRLF records). */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      records.push([...record, field]);
      record = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field || record.length) records.push([...record, field]);
  return records;
}

/** Anonymous respondent on a phone fills the second page and submits. */
async function submitFromPhone(
  browser: Browser,
  publicPath: string,
  stars: number,
) {
  const phone = await browser.newContext({ ...devices["Pixel 7"] });
  const p = await phone.newPage();
  await p.goto(publicPath);
  await p.getByTestId("next-page").click({ timeout: 30_000 });
  const q = (title: string) =>
    p.locator("[data-question-key]").filter({ hasText: title });
  await q("Overall, how satisfied are you?")
    .getByTitle(`${stars} of 5 stars`)
    .click();
  await q("How likely are you to recommend us")
    .getByRole("radio", { name: "9", exact: true })
    .click();
  await q("May we contact you").getByRole("radio", { name: "No" }).click();
  // Anti-spam: forms filled faster than 3 s are rejected.
  await p.waitForTimeout(3100);
  await p.getByTestId("submit-form").click();
  await expect(p.getByTestId("thank-you")).toBeVisible();
  await phone.close();
}

test("journey: admin, editor publishes, phone respondent, live dashboard, viewer, public link, CSV export", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // 1. Admin signs in and reaches the admin area.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await login(admin, "admin@formpulse.test");
  await admin.goto("/en/admin/users");
  await expect(admin.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(admin.getByText("editor@formpulse.test")).toBeVisible();
  await adminContext.close();

  // 2. Editor builds and publishes a form, then shares it with the viewer.
  const editorContext = await browser.newContext();
  const page = await editorContext.newPage();
  await login(page, "editor@formpulse.test");
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("template-customer_satisfaction").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });
  const formId = page.url().match(/forms\/([0-9a-f-]{36})/)![1];
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("version-badge")).toHaveText("v1");
  await page.getByTestId("public-link-button").click();
  const publicPath = new URL(await page.getByTestId("public-url").inputValue())
    .pathname;
  await page.keyboard.press("Escape");

  await page.getByTestId("tab-settings").click();
  await page.getByTestId("member-email").fill("viewer@formpulse.test");
  await page.getByTestId("member-add").click();
  await expect(page.getByTestId("member-viewer@formpulse.test")).toBeVisible();

  // 3. The editor's dashboard is live before anything is submitted.
  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("live-badge")).toHaveAttribute(
    "data-status",
    "live",
    {
      timeout: 15_000,
    },
  );
  await expect(page.getByTestId("kpi-total")).toHaveText("0");

  // 4. An anonymous visitor submits on a phone; the dashboard updates live.
  await submitFromPhone(browser, publicPath, 4);
  await expect(page.getByTestId("kpi-total")).toHaveText("1", {
    timeout: 5_000,
  });

  // 5. The shared viewer sees a read-only dashboard.
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await login(viewer, "viewer@formpulse.test");
  await viewer.goto(`/en/forms/${formId}/dashboard`);
  await expect(viewer.getByTestId("dashboard")).toBeVisible({
    timeout: 45_000,
  });
  await expect(viewer.getByTestId("kpi-total")).toHaveText("1");
  await expect(viewer.getByTestId("edit-dashboard")).toHaveCount(0);
  await expect(viewer.getByTestId("share-dashboard")).toHaveCount(0);
  await viewerContext.close();

  // 6. Public link: created by the editor, opened without an account, polls.
  await page.getByTestId("share-dashboard").click();
  await page.getByTestId("create-share").click();
  const shareUrl = await page.getByTestId("share-url").first().inputValue();
  expect(shareUrl).toMatch(/\/en\/d\/[A-Za-z0-9_-]{43}$/);
  await page.keyboard.press("Escape");

  const anonContext = await browser.newContext();
  const anon = await anonContext.newPage();
  const sharePath = new URL(shareUrl).pathname;
  const response = await anon.goto(sharePath);
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(anon.getByTestId("public-dashboard")).toBeVisible({
    timeout: 45_000,
  });
  await expect(anon.getByTestId("live-badge")).toHaveAttribute(
    "data-status",
    "polling",
  );
  await expect(anon.getByTestId("kpi-total")).toHaveText("1");
  await expect(anon.getByTestId("edit-dashboard")).toHaveCount(0);
  await expect(anon.getByTestId("export-menu")).toHaveCount(0);
  const meta = await anon
    .locator('meta[name="robots"]')
    .getAttribute("content");
  expect(meta).toContain("noindex");

  await submitFromPhone(browser, publicPath, 5);
  // Anonymous viewers poll every 10 s.
  await expect(anon.getByTestId("kpi-total")).toHaveText("2", {
    timeout: 20_000,
  });

  // Revoking the link stops it immediately.
  await page.getByTestId("share-dashboard").click();
  await page.getByTestId("share-revoke").first().click();
  await page.getByRole("button", { name: "Revoke" }).last().click();
  await expect(page.getByText("Link revoked.")).toBeVisible();
  await page.keyboard.press("Escape");
  await anon.reload();
  await expect(anon.getByTestId("share-unavailable")).toBeVisible({
    timeout: 30_000,
  });
  await anonContext.close();

  // 7. CSV export has one row per response (UTF-8 BOM, CRLF, header first).
  const csv = await page.request.get(
    `/api/forms/${formId}/export?format=csv&ui=en`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = (await csv.body()).toString("utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const records = parseCsv(text.slice(1));
  expect(records).toHaveLength(3);
  const [header, ...rows] = records;
  expect(header[0]).toBe("Response ID");
  const ratingColumn = header.indexOf("Overall, how satisfied are you?");
  expect(ratingColumn).toBeGreaterThan(0);
  expect(rows.map((r) => r[ratingColumn]).sort()).toEqual(["4", "5"]);

  const xlsx = await page.request.get(
    `/api/forms/${formId}/export?format=xlsx&ui=en`,
  );
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  await editorContext.close();
});
