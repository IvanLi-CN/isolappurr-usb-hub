import { expect, test } from "@playwright/test";

test("keeps dark warning actions in the warning palette", async ({ page }) => {
  await page.goto("/?demo=true");
  await page.getByRole("button", { name: "isolapurr ▾" }).click();
  await page.getByRole("menuitemradio", { name: "isolapurr-dark" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "isolapurr-dark",
  );
  await page.goto("/devices/aabbcc001122/info?demo=true");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "isolapurr-dark",
  );

  const clearButton = page
    .getByTestId("device-name-settings")
    .getByRole("button", { name: "Clear", exact: true });
  await expect(
    page.getByText("Manage via http", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("app-header-device-title")).toHaveText(
    "Bench Hub Alpha",
  );
  await expect(page.getByTestId("device-name-input")).toHaveValue(
    "Bench Hub Alpha",
  );
  await expect(
    page.getByText("Unsupported by this firmware", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("unknown", { exact: true })).toHaveCount(0);
  await expect(clearButton).toBeVisible();
  await expect(clearButton).toBeEnabled();
  const warningTokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      actionBorder: root.getPropertyValue("--action-warning-border").trim(),
      badgeBorder: root.getPropertyValue("--badge-warning-border").trim(),
      actionText: root.getPropertyValue("--action-warning-text").trim(),
      badgeText: root.getPropertyValue("--badge-warning-text").trim(),
    };
  });

  expect(warningTokens.actionBorder).toBe(warningTokens.badgeBorder);
  expect(warningTokens.actionText).toBe(warningTokens.badgeText);
});

test("keeps system-dark warning actions in the warning palette", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/devices/aabbcc001122/info?demo=true");
  await page.getByText("Manage via http", { exact: true }).waitFor();
  await page.evaluate(() =>
    document.documentElement.removeAttribute("data-theme"),
  );

  const warningTokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      actionBorder: root.getPropertyValue("--action-warning-border").trim(),
      badgeBorder: root.getPropertyValue("--badge-warning-border").trim(),
      actionText: root.getPropertyValue("--action-warning-text").trim(),
      badgeText: root.getPropertyValue("--badge-warning-text").trim(),
    };
  });

  expect(warningTokens.actionBorder).toBe(warningTokens.badgeBorder);
  expect(warningTokens.actionText).toBe(warningTokens.badgeText);
});
