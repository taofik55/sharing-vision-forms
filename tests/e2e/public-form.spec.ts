import { devices, expect, test, type Page } from "@playwright/test";

const PASSWORD = "Password123!";

/** Editor creates the Customer Satisfaction template, publishes it and requires an email. */
async function publishFormRequiringEmail(page: Page): Promise<string> {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("editor@formpulse.test");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/, { timeout: 30_000 });

  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("template-customer_satisfaction").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });
  await page.getByTestId("publish-button").click();
  await expect(page.getByTestId("version-badge")).toHaveText("v1");

  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("settings-form")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("combobox", { name: "Respondent identifier" }).click();
  await page.getByRole("option", { name: "Email", exact: true }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  return page.getByTestId("public-url").inputValue();
}

function question(page: Page, title: string) {
  return page.locator("[data-question-key]").filter({ hasText: title });
}

test.describe("respondent on a phone", () => {
  test("fills half, reloads, resumes, submits, and is blocked from submitting twice", async ({
    page,
    browser,
  }) => {
    const url = await publishFormRequiringEmail(page);
    const publicPath = new URL(url).pathname;

    const phone = await browser.newContext({ ...devices["Pixel 7"] });
    const p = await phone.newPage();
    await p.goto(publicPath);

    // Identifier step
    await expect(p.getByTestId("identifier-step")).toBeVisible({
      timeout: 30_000,
    });
    await p.getByTestId("identifier-continue").click();
    await expect(p.getByText("Enter your email address.").last()).toBeVisible();
    await p.getByLabel("Email").fill("Respondent@Example.com");
    await p.getByTestId("identifier-continue").click();

    // Page 1 of 2
    await expect(p.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    await question(p, "Your name").getByRole("textbox").fill("Ani Wijaya");
    await question(p, "How many times did you visit us this year?")
      .getByRole("spinbutton")
      .fill("3");
    await p.getByTestId("next-page").click();

    // Page 2: answer one question, then leave
    await expect(p.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    await question(p, "Overall, how satisfied are you?")
      .getByTitle("2 of 5 stars")
      .click();
    await expect(question(p, "What should we improve?")).toBeVisible(); // logic: rating < 3
    await p.waitForTimeout(800); // local draft debounce (500 ms)

    await p.reload();
    await expect(p.getByTestId("resume-prompt")).toBeVisible({
      timeout: 30_000,
    });
    await p.getByTestId("resume-continue").click();

    // Back on page 2 with the earlier answers
    await expect(p.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    await expect(question(p, "What should we improve?")).toBeVisible();
    await expect(
      p.getByText("Responding as Respondent@Example.com"),
    ).toBeVisible();
    await p.getByRole("button", { name: "Back" }).click();
    await expect(question(p, "Your name").getByRole("textbox")).toHaveValue(
      "Ani Wijaya",
    );
    await p.getByTestId("next-page").click();

    // Finish
    await question(p, "How likely are you to recommend us")
      .getByRole("radio", { name: "9" })
      .click();
    await question(p, "What should we improve?")
      .getByRole("textbox")
      .fill("Shorter queues please.");
    await question(p, "May we contact you")
      .getByRole("radio", { name: "No" })
      .click();
    // Anti-spam: the page must be open for 3 s (it restarted on reload).
    await p.waitForTimeout(3100);
    await p.getByTestId("submit-form").click();

    await expect(p.getByTestId("thank-you")).toBeVisible();
    await expect(p.getByText("Thank you for your feedback!")).toBeVisible();
    // Identifier forms do not offer another response.
    await expect(
      p.getByRole("button", { name: "Submit another response" }),
    ).toHaveCount(0);

    // Second attempt with the same email (different case) is blocked.
    await p.reload();
    await expect(p.getByTestId("identifier-step")).toBeVisible({
      timeout: 30_000,
    });
    await p.getByLabel("Email").fill("respondent@example.com ");
    await p.getByTestId("identifier-continue").click();
    await p.getByTestId("next-page").click();
    await question(p, "Overall, how satisfied are you?")
      .getByTitle("5 of 5 stars")
      .click();
    await question(p, "How likely are you to recommend us")
      .getByRole("radio", { name: "10" })
      .click();
    await question(p, "May we contact you")
      .getByRole("radio", { name: "No" })
      .click();
    await p.waitForTimeout(3100); // anti-bot minimum fill time
    await p.getByTestId("submit-form").click();
    await expect(p.getByTestId("submit-error")).toContainText(
      "already submitted",
    );
    await expect(p.getByTestId("thank-you")).toHaveCount(0);

    await phone.close();
  });
});
