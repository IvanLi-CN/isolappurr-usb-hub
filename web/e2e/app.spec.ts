import { expect, test } from "@playwright/test";

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string): number => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) {
      throw new Error(`Unsupported color: ${color}`);
    }
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

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
  await expect(
    page.getByTestId("device-card-aabbcc001122"),
  ).not.toHaveAttribute("aria-current");

  await page.getByTestId("device-card-aabbcc001122").click();
  await expect(page.getByTestId("device-dashboard")).toBeVisible();
  await expect(page.getByTestId("device-card-aabbcc001122")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByTestId("device-selected-marker-aabbcc001122"),
  ).toBeVisible();

  const selectedCard = page.getByTestId("device-card-aabbcc001122");
  const selectionColors = async () =>
    selectedCard.evaluate((card) => {
      const marker = card.querySelector(
        '[data-testid="device-selected-marker-aabbcc001122"]',
      );
      if (!marker) {
        throw new Error("Selected marker is missing");
      }
      const cardStyles = getComputedStyle(card);
      const markerStyles = getComputedStyle(marker);
      return {
        cardBackground: cardStyles.backgroundColor,
        cardBorder: cardStyles.borderColor,
        markerBackground: markerStyles.backgroundColor,
        markerText: markerStyles.color,
      };
    });

  const lightColors = await selectionColors();
  expect(
    contrastRatio(lightColors.cardBorder, lightColors.cardBackground),
  ).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(lightColors.markerText, lightColors.markerBackground),
  ).toBeGreaterThanOrEqual(4.5);

  await page.evaluate(() => {
    window.localStorage.setItem(
      "isolapurr_usb_hub.theme",
      JSON.stringify("isolapurr-dark"),
    );
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "isolapurr-dark",
  );
  const darkColors = await selectionColors();
  expect(
    contrastRatio(darkColors.cardBorder, darkColors.cardBackground),
  ).toBeGreaterThanOrEqual(3);
  expect(
    contrastRatio(darkColors.markerText, darkColors.markerBackground),
  ).toBeGreaterThanOrEqual(4.5);

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
  const manifestJson = await manifest.json();
  const installIconVersions = manifestJson.icons.map((icon: { src: string }) =>
    new URL(icon.src, "https://isolapurr.example").searchParams.get("v"),
  );
  expect([...new Set(installIconVersions)]).toHaveLength(1);
  expect(installIconVersions[0]).toMatch(/^[0-9a-f]{12}$/);
  expect(manifestJson.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: expect.stringMatching(/^icons\/pwa-192\.png\?v=[0-9a-f]{12}$/),
        purpose: "any",
      }),
      expect.objectContaining({
        src: expect.stringMatching(/^icons\/pwa-512\.png\?v=[0-9a-f]{12}$/),
        purpose: "any",
      }),
      expect.objectContaining({
        src: expect.stringMatching(
          /^icons\/maskable-192\.png\?v=[0-9a-f]{12}$/,
        ),
        purpose: "maskable",
      }),
      expect.objectContaining({
        src: expect.stringMatching(
          /^icons\/maskable-512\.png\?v=[0-9a-f]{12}$/,
        ),
        purpose: "maskable",
      }),
    ]),
  );
  await expect(page.locator('link[rel="icon"][sizes="any"]')).toHaveAttribute(
    "href",
    /favicon\.ico\?v=[0-9a-f]{12}$/,
  );
  await expect(
    page.locator('link[rel="icon"][type="image/svg+xml"]'),
  ).toHaveAttribute("href", /isolapurr-mark\.svg\?v=[0-9a-f]{12}$/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /apple-touch-icon\.png\?v=[0-9a-f]{12}$/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /brand\/github-social-preview\.png$/,
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    /brand\/github-social-preview\.png$/,
  );

  await page.waitForFunction(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.length > 0;
  });
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
  await expect(page.getByTestId("not-found-path")).toContainText(
    "Missing path:",
  );
  await expect(page.getByTestId("not-found-path")).toContainText(
    "/missing-route",
  );
  await expect(page.getByTestId("device-list")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("link", { name: "About" })).toHaveAttribute(
    "href",
    "/about",
  );
});

test("renders the repeatable firmware probe state in the demo workbench", async ({
  page,
}) => {
  await page.goto("/flash?demo=true&webUsb=authorized&probe=reading");

  await expect(page.getByTestId("firmware-flash-page")).toBeVisible();
  await expect(page.getByText("Reading target identity…")).toBeVisible();
  await expect(page.getByText("Serial link", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("firmware-flash-probe-countdown"),
  ).toBeVisible();
  await expect(page.getByText("Probe window", { exact: true })).toBeVisible();
});

test("keeps the probe countdown hidden before a demo read starts", async ({
  page,
}) => {
  await page.goto("/flash?demo=true&webUsb=authorized");

  await expect(page.getByTestId("firmware-flash-page")).toBeVisible();
  await expect(page.getByText("Probe window", { exact: true })).toHaveCount(0);
});
