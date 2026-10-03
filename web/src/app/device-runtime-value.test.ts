import { describe, expect, test } from "bun:test";

import {
  createEmptyChannels,
  type DeviceRuntime,
} from "./device-runtime-support";
import { resolveConnectionPresentation } from "./device-runtime-value";

function runtime(
  transport: DeviceRuntime["transport"],
  activeEndpoint: DeviceRuntime["activeEndpoint"],
  identityVerified = true,
): DeviceRuntime {
  return {
    lastOkAt: Date.now(),
    lastError: null,
    transport,
    activeEndpoint,
    identityVerified,
    channels: createEmptyChannels(),
    hub: null,
    ports: null,
    pending: { port_a: false, port_c: false },
    powerConfig: null,
    idleBias: null,
    pdDiagnostics: null,
    revision: 0,
    command: null,
  };
}

describe("resolveConnectionPresentation", () => {
  test("uses the identity-verified HTTP request URL as the endpoint", () => {
    expect(
      resolveConnectionPresentation(
        "online",
        runtime("http", {
          kind: "http",
          url: "http://192.168.31.224",
        }),
      ),
    ).toEqual({
      connectionLabel: "Wi-Fi / LAN",
      endpointLabel: "http://192.168.31.224",
    });
  });

  test("uses only the active Local USB OS path", () => {
    expect(
      resolveConnectionPresentation(
        "online",
        runtime("local_usb", {
          kind: "local_usb",
          portPath: "/dev/cu.usbmodem21231401",
        }),
      ),
    ).toEqual({
      connectionLabel: "Local USB",
      endpointLabel: "/dev/cu.usbmodem21231401",
    });
  });

  test("describes the current browser-authorized port and available USB IDs", () => {
    expect(
      resolveConnectionPresentation(
        "online",
        runtime("web_serial", {
          kind: "web_serial",
          usbVendorId: 0x303a,
          usbProductId: 0x1001,
        }),
      ),
    ).toEqual({
      connectionLabel: "Web Serial",
      endpointLabel: "Browser-authorized serial port (VID 0x303A, PID 0x1001)",
    });
    expect(
      resolveConnectionPresentation(
        "online",
        runtime("web_serial", { kind: "web_serial" }),
      ).endpointLabel,
    ).toBe("Browser-authorized serial port (details unavailable)");
  });

  test("does not reuse saved or previous endpoints when unverified or disconnected", () => {
    const active = runtime("http", {
      kind: "http",
      url: "http://192.168.31.224",
    });

    expect(
      resolveConnectionPresentation("online", {
        ...active,
        identityVerified: false,
      }),
    ).toEqual({
      connectionLabel: "Wi-Fi / LAN",
      endpointLabel: "Unavailable",
    });
    expect(resolveConnectionPresentation("offline", active)).toEqual({
      connectionLabel: "Not connected",
      endpointLabel: "Unavailable",
    });
    expect(resolveConnectionPresentation("unknown", active)).toEqual({
      connectionLabel: "Not connected",
      endpointLabel: "Unavailable",
    });
  });

  test("rejects metadata from a transport other than the active one", () => {
    expect(
      resolveConnectionPresentation(
        "online",
        runtime("local_usb", {
          kind: "http",
          url: "http://192.168.31.224",
        }),
      ),
    ).toEqual({
      connectionLabel: "Local USB",
      endpointLabel: "Unavailable",
    });
  });
});
