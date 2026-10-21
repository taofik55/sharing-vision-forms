import { expect, test, type Page } from "@playwright/test";

// CAPI interviews on the seeded BRI UMKM sample form (`pnpm seed:bri`).
const PASSWORD = "Password123!";
const SAMPLE = /Contoh/;

async function login(page: Page, email: string) {
  await page.goto("/id/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL(/\/id(\/interviews)?$/, { timeout: 30_000 });
}

test("surveyor: screen-out at S1, then a qualified respondent reaches module A", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    viewport: { width: 400, height: 860 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  await login(page, "surveyor.jkt@formpulse.test");
  // Surveyors land on their interview list and see nothing else.
  await expect(page).toHaveURL(/\/id\/interviews$/);
  await expect(page.getByRole("link", { name: "Formulir" })).toHaveCount(0);

  const card = page.getByTestId("interview-form").filter({ hasText: SAMPLE });
  await card.getByTestId("start-interviews").click();
  await page.getByTestId("interview-new").click();

  const q = (code: string) => page.locator(`[data-question-code="${code}"]`);
  await q("S1").getByText("Karyawan/anggota keluarga").click();
  await expect(page.getByTestId("screen-out")).toBeVisible();
  await page.getByTestId("screen-out-submit").click();
  await expect(page.getByTestId("interview-result")).toHaveAttribute(
    "data-result",
    "screened",
    { timeout: 30_000 },
  );

  await page.getByTestId("interview-next").click();
  await q("S1")
    .getByText(/^1Pemilik$/)
    .click();
  await expect(page.getByTestId("screen-out")).toHaveCount(0);
  await q("S2").getByText("Kuliner/F&B").click();
  await q("S3").getByText("Lebih dari 5 tahun").click();
  await q("S4").locator("input").fill("35");
  await q("S5")
    .getByText(/^2BCA$/)
    .click();
  await q("S6").getByText("6–10 kali").click();
  await q("S7").getByText("Ya, QRIS").click();
  await q("S8a")
    .getByText(/^2Tidak$/)
    .click();
  await q("S8b")
    .getByText(/^2Tidak$/)
    .click();
  await q("S9").getByText("Tidak, usaha mandiri").click();
  await q("S10").getByText("Jakarta").click();
  await q("S10_KEC").locator("input").fill("Tebet");
  await q("S10_ALAMAT").locator("textarea").first().fill("Jl. Tebet Raya 10");
  await page.getByTestId("next-page").click();

  // Quota cell from S10 × S2 × S5, then module A (F&B branch).
  await expect(page.getByText("JKT-F-N").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(q("A1_F")).toBeVisible();
  await expect(q("A1_R")).toHaveCount(0);
  await phone.close();
});

test("editor: quota matrix, QC list and surveyor table", async ({ page }) => {
  await login(page, "editor@formpulse.test");
  await page.goto("/id/forms?q=Contoh");
  const href = await page
    .getByRole("link", { name: SAMPLE })
    .first()
    .getAttribute("href");
  const id = href!.match(/forms\/([0-9a-f-]{36})/)![1];

  await page.goto(`/id/forms/${id}/qc`);
  await expect(page.getByTestId("qc-view")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("quota-matrix")).toContainText("Jakarta");
  await expect(page.getByTestId("surveyor-table")).toContainText(
    "Surveyor Jakarta",
  );
  await expect(page.getByTestId("screenout-codes")).toContainText("S1");
  await page.getByTestId("qc-view-backcheck").click();
  await expect(page.getByTestId("qc-row").first()).toBeVisible();
});
