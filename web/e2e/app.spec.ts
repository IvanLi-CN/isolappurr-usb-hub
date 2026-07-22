import { expect, type Page, test } from "@playwright/test";

const STANDALONE_MEDIA_QUERIES = [
  "(display-mode: standalone)",
  "(display-mode: window-controls-overlay)",
  "(display-mode: fullscreen)",
];

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

async function forceStandaloneLaunchShell(page: Page) {
  await page.addInitScript(
    ({ standaloneMediaQueries }) => {
      const createMediaQueryList = (query: string, matches: boolean) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      });

      const originalMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        if (standaloneMediaQueries.includes(query)) {
          return createMediaQueryList(
            query,
            query === standaloneMediaQueries[0],
          );
        }
        return originalMatchMedia(query);
      };
    },
    { standaloneMediaQueries: STANDALONE_MEDIA_QUERIES },
  );
}

async function stubServiceWorkerForBootRecovery(
  page: Page,
  mode: "none" | "waiting",
) {
  await page.addInitScript(
    ({ recoveryMode }) => {
      const listeners = new Set<(event: Event) => void>();
      const serviceWorker = {
        controller: null,
        ready: Promise.resolve(undefined),
        addEventListener(type: string, listener: (event: Event) => void) {
          if (type === "controllerchange") {
            listeners.add(listener);
          }
        },
        removeEventListener(type: string, listener: (event: Event) => void) {
          if (type === "controllerchange") {
            listeners.delete(listener);
          }
        },
        async getRegistration() {
          if (recoveryMode !== "waiting") {
            return null;
          }

          return {
            waiting: {
              postMessage(message: { type?: string }) {
                if (message?.type !== "SKIP_WAITING") {
                  return;
                }
                setTimeout(() => {
                  for (const listener of listeners) {
                    listener(new Event("controllerchange"));
                  }
                }, 0);
              },
            },
          };
        },
        async getRegistrations() {
          return [];
        },
        async register() {
          return {
            active: null,
            addEventListener() {},
            installing: null,
            scope: "/",
            update: async () => {},
            waiting: null,
          };
        },
      };

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: serviceWorker,
      });
    },
    { recoveryMode: mode },
  );
}

async function routeOnlineDeviceWithLegacyPdDiagnostics(page: Page) {
  const jsonHeaders = {
    "access-control-allow-origin": "*",
    "content-type": "application/json",
  };
  const telemetry = {
    status: "ok",
    voltage_mv: 5000,
    current_ma: 120,
    power_mw: 600,
    sample_uptime_ms: 123456,
  };
  const state = {
    power_enabled: true,
    data_connected: true,
    replugging: false,
    busy: false,
  };
  const capabilities = {
    data_replug: true,
    power_set: true,
  };

  await page.route("**/api/v1/ports", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        hub: {
          upstream_connected: true,
          isolated_usb_fault: false,
          isolated_usb_ready: true,
          usb_c_downstream_route: "usb_c",
        },
        ports: [
          {
            portId: "port_a",
            label: "USB-A",
            telemetry,
            state,
            capabilities,
          },
          {
            portId: "port_c",
            label: "USB-C",
            telemetry,
            state,
            capabilities,
          },
        ],
      }),
      headers: jsonHeaders,
      status: 200,
    });
  });

  await page.route("**/api/v1/pd-diagnostics", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        usb_c_power_enabled: true,
        sw2303_i2c_allowed: true,
        sw2303_profile_applied: true,
        sw2303_stable_reads: 3,
        sw2303_error_latched: false,
        tps_error_latched: false,
        sw2303_readback_config: {
          available: true,
          matches_config: true,
          power_watts: 60,
          protocols: {
            pd: true,
            qc20: false,
            qc30: false,
            fcp: false,
            afc: false,
            scp: false,
            pe20: false,
            bc12: true,
            sfcp: false,
          },
          pd: {
            pps: true,
            fixed_voltages_mv: [5000, 9000, 12000],
          },
          current: {
            pps3_limit_ma: 3000,
            pd_pps_5a: false,
            type_c_broadcast_ma: 3000,
            scp_limit_ma: null,
            fcp_afc_sfcp_limit_ma: null,
          },
          fast_charge: {
            qc20_20v_enabled: false,
            qc30_20v_enabled: false,
            pe20_20v_enabled: false,
            non_pd_12v_enabled: false,
          },
        },
        sw2303_request: { mv: 5000, ma: 3000 },
        sw2303_vbus_mv: 5000,
        sw2303_last_valid_request: { mv: 5000, ma: 3000 },
        active_protocol: "pd",
        display: {
          mode: { kind: "pd", label: "PD" },
          measurements_visible: true,
          badge: { kind: "voltage", label: "5.0 V" },
        },
        usb_c_actual: telemetry,
        tps_setpoint: {
          output_enabled: true,
          discharge_enabled: false,
          mv: 5000,
          iout_limit_ma: 3000,
        },
        tps_iout_limit_readback: {
          enabled: true,
          ma: 3000,
        },
      }),
      headers: jsonHeaders,
      status: 200,
    });
  });
}

test("renders devices list and mock dashboard", async ({ page }) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const themeStorageKey = "isolapurr_usb_hub.theme";
  const device = {
    id: "aabbcc001122",
    name: "Demo Hub",
    baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
  };

  await page.addInitScript(
    ({ storageKey, themeStorageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
      window.localStorage.setItem(
        themeStorageKey,
        JSON.stringify("isolapurr-dark"),
      );
    },
    { storageKey, themeStorageKey, device },
  );

  await page.goto("/");

  await expect(page).toHaveTitle("IsolaPurr USB Hub Console");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "isolapurr-dark",
  );

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

test("keeps saved-device dashboard mounted with legacy PD diagnostics", async ({
  page,
}) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const device = {
    id: "aabbcc001122",
    name: "Demo Hub",
    baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
  };

  await routeOnlineDeviceWithLegacyPdDiagnostics(page);
  await page.addInitScript(
    ({ storageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
    },
    { storageKey, device },
  );

  await page.goto("/devices/aabbcc001122");

  await expect(page.getByTestId("device-overview-page")).toBeVisible();
  await expect(page.getByTestId("device-dashboard")).toBeVisible();
  await expect(page.getByTestId("port-card-port_a")).toBeVisible();
  await expect(page.getByTestId("port-card-port_c")).toBeVisible();
  await expect(page.getByTestId("dashboard-usb-c-live-mode")).toHaveText("PD");
  await expect(page.getByTestId("dashboard-usb-c-iout-limit")).toHaveText(
    "3.00 A",
  );
  await expect(page.getByTestId("dashboard-usb-c-tmp-temperature")).toHaveCount(
    0,
  );
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
  await expect(
    page.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(page.locator('script[src$="boot-shell.js"]')).toHaveCount(1);
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

test("shows the standalone startup shell before the app mounts", async ({
  page,
}) => {
  await forceStandaloneLaunchShell(page);

  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });

  const navigation = page.goto("/");

  await expect(page.getByTestId("pwa-startup-shell")).toBeVisible();
  await expect(page.getByTestId("pwa-startup-shell-status")).toHaveText(
    "Starting console…",
  );

  await navigation;
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByTestId("pwa-startup-shell")).toBeHidden();
});

test("self-heals a stale standalone shell by promoting a waiting service worker", async ({
  page,
}) => {
  await forceStandaloneLaunchShell(page);
  await stubServiceWorkerForBootRecovery(page, "waiting");

  let entryRequests = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    entryRequests += 1;
    if (entryRequests === 1) {
      await route.fulfill({
        status: 404,
        contentType: "text/javascript",
        body: "/* stale shell */",
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");

  await expect(page.getByTestId("pwa-startup-shell")).toBeVisible();
  await expect.poll(() => entryRequests).toBeGreaterThan(1);
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByTestId("pwa-startup-shell")).toBeHidden();
});

test("uses the failure shell repair action without clearing saved devices", async ({
  page,
}) => {
  const storageKey = "isolapurr_usb_hub.devices";
  const device = {
    id: "aabbcc001122",
    name: "Demo Hub",
    baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
  };

  await forceStandaloneLaunchShell(page);
  await stubServiceWorkerForBootRecovery(page, "none");
  await page.addInitScript(
    ({ storageKey, device }) => {
      window.localStorage.setItem(storageKey, JSON.stringify([device]));
    },
    { storageKey, device },
  );

  let entryRequests = 0;
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    entryRequests += 1;
    if (entryRequests === 1) {
      await route.fulfill({
        status: 404,
        contentType: "text/javascript",
        body: "/* missing entry bundle */",
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");

  await expect(page.getByTestId("pwa-startup-shell-status")).toHaveText(
    "App launch failed",
  );
  await expect(
    page.getByText(/without touching saved devices or theme/i),
  ).toBeVisible();

  await page.getByTestId("pwa-startup-shell-repair").click();

  const desktopSidebar = page.locator("aside");
  await expect(desktopSidebar.getByTestId("device-list")).toBeVisible();
  await expect(
    desktopSidebar.getByTestId("device-card-aabbcc001122"),
  ).toBeVisible();
  await expect(page.getByTestId("pwa-startup-shell")).toBeHidden();
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
