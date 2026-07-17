import { describe, expect, test } from "bun:test";

import {
  canResumePowerLock,
  clearPowerLockResume,
  type DeviceRuntime,
  getStablePowerLockOwner,
  markPowerLockHeld,
  resolveActiveDeviceTransport,
  resolveOrderedDeviceTransports,
} from "./device-runtime-support";

const STALE_LOCAL_USB_DEVICE = {
  id: "856a141cdbd4",
  name: "Bench Hub",
  baseUrl: "http://192.168.31.122",
  transports: {
    httpBaseUrl: "http://192.168.31.122",
    localUsbPortPath: "/dev/cu.usbmodem21231401",
  },
};

function runtimeWithVerifiedHttp(): DeviceRuntime {
  const now = Date.now();
  return {
    lastOkAt: now,
    lastError: null,
    transport: null,
    channels: {
      http: { lastOkAt: now, lastError: null },
      web_serial: { lastOkAt: null, lastError: null },
      local_usb: { lastOkAt: null, lastError: null },
    },
    hub: null,
    ports: null,
    pending: { port_a: false, port_c: false },
  };
}

function mockPowerLockStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
}

describe("historical local usb bindings", () => {
  test("reuses the same persisted power lock owner across reads", () => {
    mockPowerLockStorage();
    const first = getStablePowerLockOwner("device-a");
    const second = getStablePowerLockOwner("device-a");
    expect(second).toBe(first);
  });

  test("tracks and clears resumable power lock ownership", () => {
    mockPowerLockStorage();
    expect(canResumePowerLock("device-a", 1_000)).toBe(false);
    markPowerLockHeld("device-a", 1_000);
    expect(canResumePowerLock("device-a", 1_001)).toBe(true);
    expect(canResumePowerLock("device-a", 16_001)).toBe(false);
    clearPowerLockResume("device-a");
    expect(canResumePowerLock("device-a", 1_001)).toBe(false);
  });

  test("keep verified http ahead of a stored-but-not-live local usb binding", () => {
    expect(
      resolveOrderedDeviceTransports({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: null,
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: false,
      }),
    ).toEqual(["http", "local_usb"]);
  });

  test("drop local usb while flash page locks the device to web serial", () => {
    expect(
      resolveOrderedDeviceTransports({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: "web_serial",
        localUsbPortPath: "/dev/cu.usbmodem21231401",
        hasLocalUsbLink: true,
        hasWebSerialLink: false,
        localUsbSuppressed: true,
      }),
    ).toEqual(["http"]);
  });

  test("prefer verified http over a historical local usb path", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: null,
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: false,
      }),
    ).toBe("http");
  });

  test("never reports local usb active while flash page suppresses it", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: {
          ...runtimeWithVerifiedHttp(),
          transport: "local_usb",
          channels: {
            http: { lastOkAt: null, lastError: null },
            web_serial: { lastOkAt: null, lastError: null },
            local_usb: { lastOkAt: Date.now(), lastError: null },
          },
        },
        preferred: "local_usb",
        localUsbPortPath: "/dev/cu.usbmodem21231401",
        hasLocalUsbLink: true,
        hasWebSerialLink: false,
        localUsbSuppressed: true,
      }),
    ).toBe("http");
  });
});
