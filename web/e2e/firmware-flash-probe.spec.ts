import { expect, test } from "@playwright/test";

test("leaves the picker state when browser device selection is cancelled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requestCount = 0;
    let cancelPicker: (() => void) | null = null;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => [],
        requestPort: () => {
          requestCount += 1;
          return new Promise((_, reject) => {
            cancelPicker = () =>
              reject(
                new DOMException(
                  "No port selected by the user.",
                  "NotFoundError",
                ),
              );
          });
        },
      },
    });
    Object.assign(window, {
      __pickerRegression: {
        cancel: () => cancelPicker?.(),
        requestCount: () => requestCount,
      },
    });
  });

  await page.goto("/flash");
  await page.getByRole("button", { name: "Choose Web USB" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            __pickerRegression: { requestCount(): number };
          }
        ).__pickerRegression.requestCount(),
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    (
      window as unknown as {
        __pickerRegression: { cancel(): void };
      }
    ).__pickerRegression.cancel();
  });
  await expect(
    page.getByText("Waiting for browser device selection…"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Choose Web USB" }),
  ).toBeEnabled();
});

test("expires a Web Serial probe and ignores its late firmware response", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const actualNow = Date.now.bind(Date);
    let clockOffsetMs = 0;
    let responseReleased = false;
    const pendingRequestIds: number[] = [];
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;

    const sendResponse = (id: number) => {
      readableController?.enqueue(
        new TextEncoder().encode(
          `${JSON.stringify({
            id,
            result: {
              device: {
                device_id: "f293cc9c139e",
                mac: "9c:13:9e:f2:93:cc",
                hostname: "isolapurr-usb-hub-f293cc9c139e",
                firmware: {
                  name: "isolapurr-usb-hub",
                  version: "0.5.1",
                },
              },
            },
          })}\n`,
        ),
      );
    };
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open: async () => {
        port.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            readableController = controller;
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            const request = JSON.parse(new TextDecoder().decode(chunk)) as {
              id: number;
              method: string;
            };
            if (request.method !== "info") {
              return;
            }
            if (responseReleased) {
              queueMicrotask(() => sendResponse(request.id));
            } else {
              pendingRequestIds.push(request.id);
            }
          },
        });
      },
      close: async () => {
        port.readable = null;
        port.writable = null;
        readableController = null;
      },
    };

    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => actualNow() + clockOffsetMs,
    });
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => [port],
        requestPort: async () => port,
      },
    });
    Object.assign(window, {
      __probeRegression: {
        advancePastDeadline() {
          clockOffsetMs += 6_000;
        },
        releaseInfo() {
          responseReleased = true;
          pendingRequestIds.splice(0).forEach(sendResponse);
        },
      },
    });
  });

  await page.goto("/flash");
  await expect(page.getByText("Reading target identity…")).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        __probeRegression: { advancePastDeadline(): void };
      }
    ).__probeRegression.advancePastDeadline();
  });
  await expect(
    page.getByText("Probe timed out.", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as {
        __probeRegression: { releaseInfo(): void };
      }
    ).__probeRegression.releaseInfo();
  });
  await page.waitForTimeout(250);
  await expect(
    page.getByText("Probe timed out.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
});

test("opens an authorized Web Serial port without stale-handle polling", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let grantedLookupAt: number | null = null;
    let openedAt: number | null = null;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open: async () => {
        openedAt = performance.now();
        port.readable = new ReadableStream<Uint8Array>();
        port.writable = new WritableStream<Uint8Array>();
      },
      close: async () => {
        port.readable = null;
        port.writable = null;
      },
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => {
          grantedLookupAt = performance.now();
          return [port];
        },
        requestPort: async () => port,
      },
    });
    Object.assign(window, {
      __probeTiming: {
        elapsedToFirstOpen: () =>
          openedAt === null || grantedLookupAt === null
            ? null
            : openedAt - grantedLookupAt,
      },
    });
  });

  await page.goto("/flash");
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __probeTiming: { elapsedToFirstOpen(): number | null };
          }
        ).__probeTiming.elapsedToFirstOpen(),
      ),
    )
    .not.toBeNull();
  const elapsed = await page.evaluate(() =>
    (
      window as unknown as {
        __probeTiming: { elapsedToFirstOpen(): number };
      }
    ).__probeTiming.elapsedToFirstOpen(),
  );
  expect(elapsed).toBeLessThan(500);
});

test("confirms an authorized IsolaPurr target within five seconds repeatedly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let openCount = 0;
    let readableController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open: async () => {
        openCount += 1;
        if (openCount === 2) {
          throw new Error("Failed to open serial port.");
        }
        port.readable = new ReadableStream<Uint8Array>({
          start(controller) {
            readableController = controller;
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            const request = JSON.parse(new TextDecoder().decode(chunk)) as {
              id: number;
              method: string;
            };
            if (request.method !== "info") {
              return;
            }
            queueMicrotask(() => {
              readableController?.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({
                    id: request.id,
                    result: {
                      device: {
                        device_id: "f293cc9c139e",
                        mac: "9c:13:9e:f2:93:cc",
                        hostname: "isolapurr-usb-hub-f293cc9c139e",
                        firmware: {
                          name: "isolapurr-usb-hub",
                          version: "0.5.1",
                        },
                      },
                    },
                  })}\n`,
                ),
              );
            });
          },
        });
      },
      close: async () => {
        port.readable = null;
        port.writable = null;
        readableController = null;
      },
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        getPorts: async () => [port],
        requestPort: async () => port,
      },
    });
    localStorage.setItem(
      "isolapurr.web-serial-hardware.v1",
      JSON.stringify({
        "9c139ef293cc": {
          source: "esptool-js",
          chipType: "ESP32-S3",
          mcuModel: "ESP32-S3",
          chipRevision: "v0.2",
          flashSize: "4 MB",
          ramSize: "512 KB",
          macAddress: "9c:13:9e:f2:93:cc",
        },
      }),
    );
    Object.assign(window, {
      __successfulProbe: { openCount: () => openCount },
    });
  });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const startedAt = performance.now();
    await page.goto("/flash");
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible({
      timeout: 4_900,
    });
    expect(performance.now() - startedAt).toBeLessThan(5_000);
    await expect(page.getByText("f293cc9c139e", { exact: true })).toBeVisible();
    await expect(page.getByText("ESP32-S3", { exact: true })).toBeVisible();
    await expect(page.getByText("4 MB", { exact: true })).toBeVisible();
    await expect(page.getByText("512 KB", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            __successfulProbe: { openCount(): number };
          }
        ).__successfulProbe.openCount(),
      ),
    ).toBe(1);
  }
});
