import { afterEach, describe, expect, test } from "bun:test";

import { DEVICES_STORAGE_KEY } from "../domain/devices";
import { readMigrationPayload } from "./storage-migration";

describe("readMigrationPayload", () => {
  const store = new Map<string, string>();

  afterEach(() => {
    store.clear();
  });

  test("preserves saved device transports from localStorage", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
        },
      },
    });

    store.set(
      DEVICES_STORAGE_KEY,
      JSON.stringify([
        {
          id: "f293cc9c139e",
          name: "Bench Hub",
          baseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local/path",
          transports: {
            httpBaseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local/info",
            localUsbPortPath: "/dev/cu.usbmodem21221401",
            webSerialLabel: "ESP32-S3 USB JTAG",
          },
        },
      ]),
    );

    const payload = readMigrationPayload();

    expect(payload?.devices?.[0]).toMatchObject({
      id: "f293cc9c139e",
      baseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
      transports: {
        httpBaseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
        localUsbPortPath: "/dev/cu.usbmodem21221401",
        webSerialLabel: "ESP32-S3 USB JTAG",
      },
    });
  });
});
