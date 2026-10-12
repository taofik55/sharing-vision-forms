import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSWORD = "Password123!";

async function login(page: Page, email: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en$/);
}

/** Mouse drag with intermediate moves so dnd-kit's activation distance kicks in. */
async function drag(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2 + 12,
    from.y + from.height / 2 + 12,
    { steps: 5 },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
}

async function pick(page: Page, combobox: Locator, option: string) {
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("editor builds from a template, adds logic, previews and publishes twice", async ({
  page,
}) => {
  await login(page, "editor@formpulse.test");

  // Create from template
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("template-event_registration").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/en\/forms\/[0-9a-f-]{36}\/builder$/, {
    timeout: 45_000,
  });
  const saveStatus = page.getByTestId("save-status");
  await expect(saveStatus).toHaveAttribute("data-status", "saved");

  // Drag a "Rating" question from the palette into the last section
  const cards = page.getByTestId("question-card");
  const before = await cards.count();
  await drag(
    page,
    page.getByTestId("palette-rating"),
    page.getByTestId("section-drop-2"),
  );
  await expect(cards).toHaveCount(before + 1);
  const newCard = page
    .getByTestId("section-drop-2")
    .getByTestId("question-card")
    .filter({ hasText: "Untitled question" });
  await expect(newCard).toHaveCount(1);

  // Edit it in the inspector
  const title = page.locator("#q-title");
  await title.fill("How was the venue?");
  await expect(
    page.getByTestId("section-drop-2").getByText("How was the venue?"),
  ).toBeVisible();

  // Logic: show only if Ticket type is VIP
  await page.getByTestId("logic-enable").click();
  const condition = page.getByTestId("condition-0");
  await pick(
    page,
    condition.getByRole("combobox", { name: "Question" }),
    "Ticket type",
  );
  await pick(page, condition.getByRole("combobox", { name: "Operator" }), "is");
  await pick(page, condition.getByRole("combobox", { name: "Value" }), "VIP");
  await expect(
    page.getByTestId("section-drop-2").getByText("Has logic"),
  ).toHaveCount(2);
  await expect(saveStatus).toHaveAttribute("data-status", "saved", {
    timeout: 10_000,
  });

  // Reload right away: nothing is lost
  await page.reload();
  await expect(
    page.getByTestId("section-drop-2").getByText("How was the venue?"),
  ).toBeVisible();

  // Preview on a phone frame with the real renderer
  await page.getByTestId("preview-button").click();
  await page.getByTestId("preview-mobile").click();
  const frame = page.getByTestId("preview-frame-mobile");
  await expect(frame).toBeVisible();
  await expect(
    frame.getByRole("heading", { level: 1, name: "Event Registration" }),
  ).toBeVisible();
  await frame.getByRole("button", { name: "Next" }).click();
  await expect(
    frame.getByText("This question is required.").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Publish v1
  await page.getByTestId("publish-button").click();
  await expect(page.getByText("Published version 1.")).toBeVisible();
  await expect(page.getByTestId("version-badge")).toHaveText("v1");
  await expect(page.getByTestId("unpublished-badge")).toHaveCount(0);

  // Edit, then publish v2
  await page
    .getByTestId("section-drop-2")
    .getByText("How was the venue?")
    .click();
  await title.fill("How was the venue overall?");
  await expect(page.getByTestId("unpublished-badge")).toBeVisible();
  await page.getByTestId("publish-button").click();
  await expect(page.getByText("Published version 2.")).toBeVisible();
  await expect(page.getByTestId("version-badge")).toHaveText("v2");
  await expect(page.getByTestId("unpublished-badge")).toHaveCount(0);

  // Public link is available once published
  await page.getByTestId("public-link-button").click();
  await expect(page.getByTestId("public-url")).toHaveValue(
    /\/en\/f\/event-registration-[a-z0-9]{6}$/,
  );
});

test("undo and redo with keyboard shortcuts", async ({ page }) => {
  await login(page, "editor@formpulse.test");
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("create-form-confirm").click(); // Blank
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });

  const cards = page.getByTestId("question-card");
  await expect(cards).toHaveCount(1);
  await page.getByTestId("palette-email").click();
  await expect(cards).toHaveCount(2);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(cards).toHaveCount(1);
  await page.keyboard.press("Control+Shift+z");
  await expect(cards).toHaveCount(2);
});

test("questions can be reordered with the keyboard", async ({ page }) => {
  await login(page, "editor@formpulse.test");
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("template-employee_feedback").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });

  const firstSection = page.getByTestId("section-drop-0");
  const titles = firstSection.getByTestId("question-card");
  await expect(titles.first()).toContainText("Department");
  await firstSection.getByTestId("drag-handle").first().focus();
  // dnd-kit measures layout between key presses; pause like a human would.
  for (const key of ["Space", "ArrowDown", "Space"]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }
  await expect(titles.first()).toContainText("How long have you worked here?");
  await expect(titles.nth(1)).toContainText("Department");
});

test.describe("touch", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
  });

  test("questions can be reordered by touch (long press + drag)", async ({
    page,
  }) => {
    await login(page, "editor@formpulse.test");
    await page.goto("/en/forms");
    await page.getByTestId("create-form").click();
    await page.getByTestId("template-employee_feedback").click();
    await page.getByTestId("create-form-confirm").click();
    await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });

    const firstSection = page.getByTestId("section-drop-0");
    const cards = firstSection.getByTestId("question-card");
    await expect(cards.first()).toContainText("Department");
    // Center the list so dnd-kit auto-scroll (near viewport edges) does not kick in.
    await cards
      .first()
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    const from = (await firstSection
      .getByTestId("drag-handle")
      .first()
      .boundingBox())!;
    const first = (await cards.first().boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    // Move so the dragged card's center lands on the next card's center.
    const delta = second.y + second.height / 2 - (first.y + first.height / 2);

    const cdp = await page.context().newCDPSession(page);
    const point = (x: number, y: number) => [{ x, y, id: 1 }];
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(x, y),
    });
    await page.waitForTimeout(350); // long-press activation (200ms delay)
    const targetY = y + delta;
    for (let i = 1; i <= 15; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(x, y + ((targetY - y) * i) / 15),
      });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect(cards.first()).toContainText("How long have you worked here?");
    await expect(cards.nth(1)).toContainText("Department");
  });
});

test("warns when another editor saved a newer draft", async ({
  page,
  browser,
}) => {
  await login(page, "editor@formpulse.test");
  await page.goto("/en/forms");
  await page.getByTestId("create-form").click();
  await page.getByTestId("create-form-confirm").click();
  await expect(page).toHaveURL(/\/builder$/, { timeout: 45_000 });
  const builderUrl = page.url();

  // Second tab of another session opens the same draft.
  const other = await (await browser.newContext()).newPage();
  await login(other, "editor@formpulse.test");
  await other.goto(builderUrl);
  await expect(other.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
  );

  // Tab A saves first.
  await page
    .getByTestId("question-card")
    .first()
    .getByRole("button", { name: /Edit question/ })
    .click();
  await page.locator("#q-title").fill("Saved by tab A");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
  );

  // Tab B's save now conflicts and the editor is warned.
  await other
    .getByTestId("question-card")
    .first()
    .getByRole("button", { name: /Edit question/ })
    .click();
  await other.locator("#q-title").fill("Saved by tab B");
  await expect(other.getByRole("alertdialog")).toContainText(
    "A newer draft exists",
  );
  await other.getByTestId("conflict-overwrite").click();
  await expect(other.getByTestId("save-status")).toHaveAttribute(
    "data-status",
    "saved",
  );

  await page.reload();
  await expect(page.getByTestId("question-card").first()).toContainText(
    "Saved by tab B",
  );
  await other.context().close();
});
