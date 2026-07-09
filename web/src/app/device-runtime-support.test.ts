import { describe, expect, test } from "bun:test";

import {
  type DeviceRuntime,
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

describe("historical local usb bindings", () => {
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
