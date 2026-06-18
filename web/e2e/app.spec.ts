import { expect, test } from "@playwright/test";

test("renders devices list and mock dashboard", async ({ page }) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const device = {
    id: "aabbcc001122",
    name: "Demo Hub",
    baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
  };

  await page.addInitScript(
    ({ storageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
    },
    { storageKey, device },
  );

  await page.goto("/");

  await expect(page).toHaveTitle("IsolaPurr USB Hub Console");

  await expect(page.getByTestId("device-list")).toBeVisible();
  await expect(page.getByTestId("device-card-aabbcc001122")).toBeVisible();

  await page.getByTestId("device-card-aabbcc001122").click();
  await expect(page.getByTestId("device-dashboard")).toBeVisible();

  await expect(page.getByTestId("port-card-port_a")).toBeVisible();
  await expect(page.getByTestId("port-card-port_c")).toBeVisible();
});

test("publishes PWA metadata and offline app shell", async ({
  page,
  context,
}) => {
  await page.goto("/");

  const manifestHref = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifestHref).toBeTruthy();

  const manifest = await page.request.get(
    manifestHref ?? "/manifest.webmanifest",
  );
  expect(manifest.ok()).toBe(true);
  await expect(
    page.locator('link[rel="icon"][type="image/svg+xml"]'),
  ).toHaveAttribute("href", /isolapurr-mark\.svg/);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await context.setOffline(false);
});

test("opens add device modal with supported connection methods (web)", async ({
  page,
}) => {
  const storageKey = "isolapurr_usb_hub.devices";
  await page.addInitScript(
    ({ storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([]));
    },
    { storageKey },
  );

  await page.goto("/");

  await page
    .getByTestId("device-list")
    .getByRole("button", { name: "+ Add" })
    .click();

  const dialog = page.getByTestId("add-device-dialog");
  await expect(dialog).toBeVisible();

  await expect(
    dialog.getByText("Auto discovery", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("IP scan (advanced)", { exact: true }),
  ).toBeVisible();

  await dialog.getByRole("tab", { name: /Web Serial/ }).click();
  await expect(
    dialog.getByText("Add by Web Serial", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Connect and add" }),
  ).toBeVisible();

  await dialog.getByRole("tab", { name: /Local USB/ }).click();
  await expect(
    dialog.getByText("Add by Local USB", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Use the local desktop service to read the connected hub over USB and add it here.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("renders standalone 404 fallback for unknown routes", async ({ page }) => {
  await page.goto("/missing-route");

  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByTestId("error-state-full-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  await expect(page.getByTestId("not-found-path")).toHaveText(
    "Missing path: /missing-route",
  );
  await expect(page.getByTestId("device-list")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to Dashboard" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "About" })).toHaveAttribute(
    "href",
    "/about",
  );
});
