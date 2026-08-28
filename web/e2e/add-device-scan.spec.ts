import { expect, test } from "@playwright/test";

test("keeps add device open while discovered results remain addable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("isolapurr.demo.enabled", "true");
  });

  await page.goto("/?demo=true");
  await page.evaluate(async () => {
    const raw = window.sessionStorage.getItem("isolapurr.demo.world");
    if (!raw) {
      throw new Error("demo world was not initialized");
    }
    const world = JSON.parse(raw) as { devices: unknown[] };
    world.devices = [];
    window.sessionStorage.setItem(
      "isolapurr.demo.world",
      JSON.stringify(world),
    );
    window.dispatchEvent(new CustomEvent("isolapurr-demo-reset"));
  });
  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();
  const dialog = page.getByTestId("add-device-dialog");
  await expect(dialog).toBeVisible();
  const addButtons = dialog
    .locator("div.divide-y")
    .getByRole("button", { name: "Add", exact: true });
  await expect(addButtons).toHaveCount(3);
  await addButtons.nth(0).click();
  await expect(dialog).toBeVisible();
  await expect(addButtons).toHaveCount(2);
  await expect(page).toHaveURL(/\/\?demo=true$/);
  await addButtons.nth(1).click();
  await expect(dialog).toBeVisible();
  await expect(addButtons).toHaveCount(1);
  await addButtons.nth(0).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/devices\//);
});

test("restores only a valid ten-minute IP scan session on dialog open", async ({
  page,
}) => {
  const key = "isolapurr_usb_hub.ip_scan_session.v1.demo";
  const completedAt = Date.now();
  await page.addInitScript(
    ({ key, completedAt }) => {
      window.sessionStorage.setItem("isolapurr.demo.enabled", "true");
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          cidr: "192.168.31.0/24",
          devices: [
            {
              baseUrl: "http://192.168.31.60",
              device_id: "aabbcc001122",
              hostname: "isolapurr-usb-hub-aabbcc001122",
            },
          ],
          completedAt,
          expiresAt: completedAt + 600_000,
        }),
      );
    },
    { key, completedAt },
  );

  await page.goto("/?demo=true");
  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();
  const dialog = page.getByTestId("add-device-dialog");
  await expect(dialog.getByTestId("last-ip-scan-session")).toContainText(
    "192.168.31.0/24",
  );
  await expect(dialog.locator('input[value="192.168.31.0/24"]')).toBeVisible();

  await page.reload();
  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();
  await expect(dialog.getByTestId("last-ip-scan-session")).toBeVisible();
});

test("removes an expired IP scan session when dialog opens", async ({
  page,
}) => {
  const key = "isolapurr_usb_hub.ip_scan_session.v1.live";
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          cidr: "192.168.31.0/24",
          devices: [],
          completedAt: Date.now() - 601_000,
          expiresAt: Date.now() - 1_000,
        }),
      );
    },
    { key },
  );

  await page.goto("/");
  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();
  await expect(page.getByTestId("last-ip-scan-session")).toHaveCount(0);
  expect(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
  ).toBeNull();
});
