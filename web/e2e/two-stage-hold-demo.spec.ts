import { expect, type Locator, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function holdFor(page: Page, control: Locator, durationMs: number) {
  const button = control.locator(".two-stage-hold__button");
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(durationMs);
  await page.mouse.up();
}

async function expectVisibleControlText(control: Locator) {
  const measurements = await control.evaluate((root) => {
    const measure = (selector: string) => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) {
        return null;
      }
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };

    return {
      label: measure(".two-stage-hold__label"),
      feedback: measure(".two-stage-hold__feedback"),
      feedbackText:
        root.querySelector(".two-stage-hold__feedback")?.textContent?.trim() ??
        null,
      statusIconCount: root.querySelectorAll(".two-stage-hold__status-icon")
        .length,
    };
  });

  expect(measurements.label).not.toBeNull();
  expect(measurements.feedback).not.toBeNull();
  expect(measurements.label?.scrollWidth).toBeLessThanOrEqual(
    measurements.label?.clientWidth ?? 0,
  );
  expect(measurements.feedback?.scrollWidth).toBeLessThanOrEqual(
    measurements.feedback?.clientWidth ?? 0,
  );
  expect(measurements.feedbackText).toBe("");
  expect(measurements.statusIconCount).toBe(1);
}

async function openDemoDashboard(page: Page) {
  const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "45175"}`;
  const session = await page.context().newCDPSession(page);
  await session.send("Storage.clearDataForOrigin", {
    origin,
    storageTypes: "all",
  });
  await session.detach();
  await page.goto("/?demo=true");
  await expect(page.getByTestId("dashboard")).toBeVisible();
}

test("demo dashboard keeps compact hold controls legible through every action", async ({
  page,
}) => {
  await openDemoDashboard(page);

  const summary = page.getByTestId("device-summary-aabbcc001122");
  const controls = summary.locator(".two-stage-hold");
  await expect(controls).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    await expectVisibleControlText(controls.nth(index));
  }

  const power = controls.nth(0);
  await holdFor(page, power, 180);
  await expect(power).toHaveAttribute("data-phase", "hint");
  await expect(power.locator(".two-stage-hold__feedback")).toHaveAttribute(
    "aria-label",
    "Power on",
  );
  await expectVisibleControlText(power);
});

test("demo dashboard keeps an opened compact tooltip above the detail action", async ({
  page,
}) => {
  await openDemoDashboard(page);

  const summary = page.getByTestId("device-summary-aabbcc001122");
  const power = summary.locator(".two-stage-hold").first();
  const tooltip = power.getByRole("tooltip");

  await power.locator(".two-stage-hold__button").click();
  await expect(tooltip).toHaveAttribute("data-visible", "true");
  await expect(power).toHaveAttribute("data-tooltip-open", "true");

  const layers = await Promise.all([
    power.evaluate((element) =>
      Number.parseInt(getComputedStyle(element).zIndex, 10),
    ),
    summary
      .getByRole("button", { name: "Open details →" })
      .evaluate((element) => {
        const zIndex = getComputedStyle(element).zIndex;
        return zIndex === "auto" ? 0 : Number.parseInt(zIndex, 10);
      }),
  ]);
  expect(layers[0]).toBeGreaterThan(layers[1]);

  const [powerBox, tooltipBox] = await Promise.all([
    power.locator(".two-stage-hold__button").boundingBox(),
    tooltip.boundingBox(),
  ]);
  expect(powerBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();
  if (!powerBox || !tooltipBox) {
    return;
  }
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(powerBox.y);
});

test("demo dashboard commits the first stage and restores after the second", async ({
  page,
}) => {
  await openDemoDashboard(page);

  const power = page
    .getByTestId("device-summary-aabbcc001122")
    .locator(".two-stage-hold")
    .first();
  const firstSnapshot = await power
    .locator(".two-stage-hold__button")
    .getAttribute("aria-pressed");
  const firstTarget = firstSnapshot === "true" ? "false" : "true";

  await holdFor(page, power, 920);
  await expect(power.locator(".two-stage-hold__button")).toHaveAttribute(
    "aria-pressed",
    firstTarget,
  );
  await expect(power.locator(".two-stage-hold__feedback")).toHaveAttribute(
    "aria-label",
    firstTarget === "true" ? "Power on" : "Power off",
  );
  await expectVisibleControlText(power);

  await page.reload();
  const restoredPower = page
    .getByTestId("device-summary-aabbcc001122")
    .locator(".two-stage-hold")
    .first();
  const restoreSnapshot = await restoredPower
    .locator(".two-stage-hold__button")
    .getAttribute("aria-pressed");
  await holdFor(page, restoredPower, 1_420);
  await expect(
    restoredPower.locator(".two-stage-hold__button"),
  ).toHaveAttribute("aria-pressed", restoreSnapshot ?? "false");
  await expect(
    restoredPower.locator(".two-stage-hold__feedback"),
  ).toHaveAttribute(
    "aria-label",
    restoreSnapshot === "true" ? "Power on" : "Power off",
  );
  await expectVisibleControlText(restoredPower);
});

test.describe("mobile demo dashboard", () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test("stacks port cards without overlapping their controls or detail action", async ({
    page,
  }) => {
    await openDemoDashboard(page);

    const summary = page.getByTestId("device-summary-aabbcc001122");
    const controls = summary.locator(".two-stage-hold");
    await expect(controls).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      await expectVisibleControlText(controls.nth(index));
    }

    const boxes = await Promise.all(
      [0, 1, 2, 3].map((index) => controls.nth(index).boundingBox()),
    );
    const detailAction = summary.getByRole("button", {
      name: "Open details →",
    });
    const detailBox = await detailAction.boundingBox();
    expect(boxes.every((box) => box !== null)).toBe(true);
    expect(detailBox).not.toBeNull();
    if (boxes.some((box) => box === null) || !detailBox) {
      return;
    }

    const controlBoxes = boxes.filter(
      (box): box is NonNullable<typeof box> => box !== null,
    );
    const lowerPortBottom = Math.max(
      controlBoxes[2].y + controlBoxes[2].height,
      controlBoxes[3].y + controlBoxes[3].height,
    );
    expect(controlBoxes[2].y).toBeGreaterThan(
      controlBoxes[0].y + controlBoxes[0].height,
    );
    expect(detailBox.y).toBeGreaterThanOrEqual(lowerPortBottom + 8);
  });
});

test("demo retains semantic state without motion when reduced motion is requested", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDemoDashboard(page);

  const power = page
    .getByTestId("device-summary-aabbcc001122")
    .locator(".two-stage-hold")
    .first();
  await holdFor(page, power, 180);

  await expect(power).toHaveAttribute("data-phase", "hint");
  await expect(power.locator(".two-stage-hold__feedback")).toHaveAttribute(
    "aria-label",
    "Power on",
  );
  await expectVisibleControlText(power);
  await expect(power.locator(".two-stage-hold__button")).toHaveCSS(
    "animation-name",
    "none",
  );
});
