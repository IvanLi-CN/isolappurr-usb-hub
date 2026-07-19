import { expect, type Page, test } from "@playwright/test";

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

async function mockPwaInstallState(
  page: Page,
  {
    autoAppInstalled = false,
    displayMode = "browser",
    overlayVisible = false,
    promptOutcome = "accepted",
  }: {
    autoAppInstalled?: boolean;
    displayMode?: "browser" | "standalone";
    overlayVisible?: boolean;
    promptOutcome?: "accepted" | "dismissed";
  } = {},
) {
  await page.addInitScript(
    ({ autoAppInstalled, displayMode, overlayVisible, promptOutcome }) => {
      class MockWindowControlsOverlay extends EventTarget {
        visible;

        constructor(initialVisible) {
          super();
          this.visible = initialVisible;
        }

        getTitlebarAreaRect() {
          return new DOMRect(0, 0, 0, 0);
        }
      }

      const overlay = new MockWindowControlsOverlay(overlayVisible);
      Object.defineProperty(navigator, "windowControlsOverlay", {
        configurable: true,
        value: overlay,
      });

      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const mediaQueryList = originalMatchMedia(query);
        if (query === "(display-mode: standalone)") {
          Object.defineProperty(mediaQueryList, "matches", {
            configurable: true,
            get: () => displayMode === "standalone",
          });
        }
        if (query === "(display-mode: minimal-ui)") {
          Object.defineProperty(mediaQueryList, "matches", {
            configurable: true,
            get: () => false,
          });
        }
        if (query === "(display-mode: fullscreen)") {
          Object.defineProperty(mediaQueryList, "matches", {
            configurable: true,
            get: () => false,
          });
        }
        return mediaQueryList;
      };

      window.__mockInstallPromptCalls = 0;
      window.__dispatchMockBeforeInstallPrompt = () => {
        const event = new Event("beforeinstallprompt", {
          cancelable: true,
        });
        Object.defineProperty(event, "platforms", {
          configurable: true,
          value: ["web"],
        });
        Object.defineProperty(event, "prompt", {
          configurable: true,
          value: async () => {
            window.__mockInstallPromptCalls += 1;
            if (autoAppInstalled) {
              window.dispatchEvent(new Event("appinstalled"));
            }
          },
        });
        Object.defineProperty(event, "userChoice", {
          configurable: true,
          value: Promise.resolve({
            outcome: promptOutcome,
            platform: "web",
          }),
        });
        window.dispatchEvent(event);
      };
    },
    { autoAppInstalled, displayMode, overlayVisible, promptOutcome },
  );
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

  const desktopSidebar = page.locator("aside");
  await expect(desktopSidebar.getByTestId("device-list")).toBeVisible();
  await expect(
    desktopSidebar.getByTestId("device-card-aabbcc001122"),
  ).toBeVisible();
  await expect(
    desktopSidebar.getByTestId("device-card-aabbcc001122"),
  ).not.toHaveAttribute("aria-current");

  await desktopSidebar.getByTestId("device-card-aabbcc001122").click();
  await expect(page.getByTestId("device-dashboard")).toBeVisible();
  await expect(
    desktopSidebar.getByTestId("device-card-aabbcc001122"),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    desktopSidebar.getByTestId("device-selected-marker-aabbcc001122"),
  ).toBeVisible();

  const selectedCard = desktopSidebar.getByTestId("device-card-aabbcc001122");
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

  const expectSelectionContrast = async () => {
    await expect
      .poll(async () => {
        const colors = await selectionColors();
        return contrastRatio(colors.cardBorder, colors.cardBackground);
      })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(async () => {
        const colors = await selectionColors();
        return contrastRatio(colors.markerText, colors.markerBackground);
      })
      .toBeGreaterThanOrEqual(4.5);
  };

  await expectSelectionContrast();

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
  await expectSelectionContrast();

  await expect(page.getByTestId("port-card-port_a")).toBeVisible();
  await expect(page.getByTestId("port-card-port_c")).toBeVisible();
});

test("promotes saved-device identity into the desktop shell header", async ({
  page,
}) => {
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

  await page.goto("/devices/aabbcc001122");

  await expect(page.getByTestId("app-header-device-title")).toHaveText(
    "Demo Hub",
  );
  await expect(page.getByTestId("app-header-device-subtitle")).toHaveText(
    "id: aabbcc • http://isolapurr-usb-hub-aabbcc001122.local",
  );
  await expect(
    page
      .getByTestId("device-overview-page")
      .getByRole("heading", { name: "Demo Hub" }),
  ).toHaveCount(0);

  await page.goto("/devices/aabbcc001122/power");
  await expect(page.getByTestId("app-header-device-title")).toHaveText(
    "Demo Hub",
  );
  await expect(page.getByTestId("device-power-page")).toBeVisible();
});

test("uses a mobile device drawer for dashboard and saved-device routes", async ({
  page,
}) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const device = {
    id: "aabbcc001122",
    name: "Demo Hub",
    baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    ({ storageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
    },
    { storageKey, device },
  );

  await page.goto("/");

  await expect(
    page.locator("aside").getByTestId("device-list"),
  ).not.toBeVisible();
  await page.getByTestId("mobile-device-drawer-trigger").click();
  await expect(page.getByTestId("mobile-device-drawer")).toBeVisible();

  await page
    .getByTestId("mobile-device-drawer")
    .getByRole("button", { name: "+ Add" })
    .click();
  await expect(page.getByTestId("add-device-dialog")).toBeVisible();
  await expect(page.getByTestId("mobile-device-drawer")).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("add-device-dialog")).not.toBeVisible();

  await page.getByTestId("mobile-device-drawer-trigger").click();
  await page
    .getByTestId("mobile-device-drawer")
    .getByTestId("device-card-aabbcc001122")
    .click();
  await expect(page.getByTestId("mobile-device-drawer")).not.toBeVisible();
  await expect(page.getByTestId("device-overview-page")).toBeVisible();
  await expect(page.getByTestId("app-header-mobile-title")).toHaveText(
    "Demo Hub",
  );

  await page.getByTestId("mobile-device-drawer-trigger").click();
  await page.getByTestId("mobile-device-drawer-about").click();
  await expect(page.getByTestId("about")).toBeVisible();
  await expect(page.getByTestId("mobile-device-drawer")).toHaveCount(0);
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
  expect(manifestJson.shortcuts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "Dashboard",
        url: ".",
      }),
      expect.objectContaining({
        name: "Firmware flash",
        url: "flash",
      }),
    ]),
  );
  expect(manifestJson.screenshots).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        src: "pwa/dashboard-wide.png",
        form_factor: "wide",
        sizes: "1440x900",
      }),
      expect.objectContaining({
        src: "pwa/flash-wide.png",
        form_factor: "wide",
        sizes: "1440x900",
      }),
    ]),
  );
  for (const screenshot of manifestJson.screenshots as Array<{ src: string }>) {
    const screenshotAsset = await page.request.get(
      new URL(screenshot.src, page.url()).toString(),
    );
    expect(screenshotAsset.ok()).toBe(true);
  }
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

test("shows a native install CTA and then hides it after installation", async ({
  page,
}) => {
  await mockPwaInstallState(page, { autoAppInstalled: true });
  await page.goto("/");
  await page.evaluate(() => {
    const target = window as Window & {
      __dispatchMockBeforeInstallPrompt?: () => void;
    };
    target.__dispatchMockBeforeInstallPrompt?.();
  });

  await expect(
    page.getByTestId("app-header-install-cta-desktop"),
  ).toBeVisible();
  await page.getByTestId("app-header-install-cta-desktop").click();
  await expect(page.getByTestId("app-header-install-cta-desktop")).toHaveCount(
    0,
  );
  await expect(
    page.evaluate(() => {
      const target = window as Window & {
        __mockInstallPromptCalls?: number;
      };
      return target.__mockInstallPromptCalls ?? 0;
    }),
  ).resolves.toBe(1);

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByTestId("about-install-card")).toBeVisible();
  await expect(page.getByTestId("about-install-status")).toContainText(
    "Installed",
  );
  await expect(page.getByTestId("about-install-cta")).toHaveCount(0);
});

test("keeps About fallback copy and reflects installed window chrome state", async ({
  page,
}) => {
  await mockPwaInstallState(page, {
    displayMode: "standalone",
    overlayVisible: true,
  });
  await page.goto("/about");

  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-display-mode",
    "window-controls-overlay",
  );
  await expect(page.getByTestId("app-shell")).toHaveAttribute(
    "data-window-controls-overlay",
    "visible",
  );
  await expect(page.getByTestId("about-install-status")).toContainText(
    "Installed",
  );
  await expect(page.getByText("Dashboard · Firmware flash")).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("about-install-card")).toHaveCount(0);
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

test("renders an actionable Web Serial timeout in the demo workbench", async ({
  page,
}) => {
  await page.goto("/flash?demo=true&webUsb=authorized&probe=timeout");

  await expect(
    page.getByText("Probe timed out.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The selected Web USB device did not respond within 5 seconds. Reconnect and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Probing", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Probe window", { exact: true })).toHaveCount(0);
});
