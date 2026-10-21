import { expect, test } from "@playwright/test";

// Self-administered BRI UMKM questionnaire on a public link (`pnpm seed:bri`).
test("respondent fills the self-administered form and is screened out at S1", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    viewport: { width: 400, height: 860 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  await page.goto("/id/f/survei-umkm-bri-mandiri");
  await expect(page.getByTestId("form-renderer")).toBeVisible({
    timeout: 30_000,
  });
  // No interviewer parts: no codes, no surveyor notes.
  await expect(page.getByText("Catatan surveyor")).toHaveCount(0);

  const q = (code: string) => page.locator(`[data-question-code="${code}"]`);
  await q("S1").getByText("Karyawan/anggota keluarga").click();
  await expect(page.getByTestId("screen-out")).toContainText(
    "Survei ini belum sesuai untuk Anda",
  );
  await page.getByTestId("screen-out-submit").click();
  await expect(page.getByTestId("screened-out")).toBeVisible({
    timeout: 30_000,
  });
  await phone.close();
});
