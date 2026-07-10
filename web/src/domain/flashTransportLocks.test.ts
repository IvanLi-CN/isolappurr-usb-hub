import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearFlashTransportLock,
  clearGlobalFlashTransportLock,
  isLocalUsbSuppressedForFlashDevice,
  setFlashTransportLock,
  setGlobalFlashTransportLock,
} from "./flashTransportLocks";

function installWindowMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

describe("flashTransportLocks", () => {
  beforeEach(() => {
    installWindowMock();
  });

  afterEach(() => {
    clearGlobalFlashTransportLock();
    clearFlashTransportLock("bench-device");
  });

  test("suppresses only the locked device by default", () => {
    setFlashTransportLock({
      deviceId: "bench-device",
      transport: "web_serial",
    });

    expect(isLocalUsbSuppressedForFlashDevice("bench-device")).toBe(true);
    expect(isLocalUsbSuppressedForFlashDevice("other-device")).toBe(false);
  });

  test("global lock suppresses local usb for every device", () => {
    setGlobalFlashTransportLock("web_serial");

    expect(isLocalUsbSuppressedForFlashDevice("bench-device")).toBe(true);
    expect(isLocalUsbSuppressedForFlashDevice("other-device")).toBe(true);
  });
});
