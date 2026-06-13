import { afterEach, describe, expect, test } from "bun:test";

import {
  devdLocalUsbDeviceIdFromBaseUrl,
  filterEsp32SerialPorts,
  isEsp32SerialPort,
  listLocalUsbSerialPorts,
  sendLocalUsbJsonlRequest,
  stableLocalUsbDeviceId,
} from "./hardwareConsole";

const originalFetch = globalThis.fetch;

function makeAgent() {
  return { token: "token", agentBaseUrl: "http://127.0.0.1:51200" };
}

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("isEsp32SerialPort", () => {
  test("accepts ESP32-S3 USB Serial/JTAG by USB metadata across platforms", () => {
    expect(
      isEsp32SerialPort({
        path: "COM3",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      }),
    ).toBe(true);
    expect(
      isEsp32SerialPort({
        path: "/dev/ttyACM0",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      }),
    ).toBe(true);
  });

  test("keeps unrelated local ports out of Local USB choices", () => {
    expect(
      isEsp32SerialPort({
        path: "/dev/cu.Bluetooth-Incoming-Port",
        label: "Bluetooth-Incoming-Port",
      }),
    ).toBe(false);
    expect(
      isEsp32SerialPort({
        path: "/dev/cu.debug-console",
        label: "debug console",
      }),
    ).toBe(false);
  });
});

describe("filterEsp32SerialPorts", () => {
  test("dedupes tty/cu pairs after filtering ESP32 candidates", () => {
    const ports = filterEsp32SerialPorts([
      {
        path: "/dev/tty.usbmodem21221401",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      },
      {
        path: "/dev/cu.usbmodem21221401",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      },
    ]);

    expect(ports).toHaveLength(1);
    expect(ports[0]?.path).toBe("/dev/cu.usbmodem21221401");
  });
});

describe("stableLocalUsbDeviceId", () => {
  test("matches devd USB device id derivation", () => {
    expect(stableLocalUsbDeviceId("/dev/cu.usbmodem21221401")).toBe(
      "usb--dev-cu-usbmodem21221401",
    );
  });
});

describe("devdLocalUsbDeviceIdFromBaseUrl", () => {
  test("extracts CLI/devd USB profile ids", () => {
    expect(
      devdLocalUsbDeviceIdFromBaseUrl(
        "isolapurr-devd://usb--dev-cu-usbmodem21221401",
      ),
    ).toBe("usb--dev-cu-usbmodem21221401");
    expect(devdLocalUsbDeviceIdFromBaseUrl("http://192.168.4.1")).toBeNull();
  });
});

describe("legacy Local USB fallback", () => {
  test("falls back to serial ports when devices scan returns 405", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/devices/scan")) {
        return new Response(null, { status: 405 });
      }
      if (url.endsWith("/api/v1/serial/ports")) {
        return jsonResponse({
          ports: [
            {
              path: "/dev/cu.usbmodem21221401",
              label: "USB JTAG/serial debug unit",
              vendorId: 0x303a,
              productId: 0x1001,
            },
          ],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const ports = await listLocalUsbSerialPorts(makeAgent());
    expect(ports).toHaveLength(1);
    expect(ports[0]?.path).toBe("/dev/cu.usbmodem21221401");
  });

  test("falls back to legacy serial request when devices API returns 405", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/devices/scan")) {
        return new Response(null, { status: 405 });
      }
      if (url.endsWith("/api/v1/serial/ports")) {
        return jsonResponse({
          ports: [{ path: "/dev/cu.usbmodem21221401", label: "Local USB" }],
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21221401/status")) {
        return new Response(null, { status: 405 });
      }
      if (url.endsWith("/api/v1/serial/request")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
          request?: { method?: string };
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21221401");
        expect(body.request?.method).toBe("info");
        return jsonResponse({
          response: {
            ok: true,
            result: { device: { device_id: "f293cc9c139e" } },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendLocalUsbJsonlRequest(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      { id: 1, method: "info" },
    )) as { ok: boolean; result?: { device?: { device_id?: string } } };

    expect(response.ok).toBe(true);
    expect(response.result?.device?.device_id).toBe("f293cc9c139e");
  });

  test("falls back to legacy serial request when devices API returns non-json 200", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/devices/scan")) {
        return jsonResponse({
          devices: [
            {
              id: "usb--dev-cu-usbmodem21221401",
              usb: { portPath: "/dev/cu.usbmodem21221401" },
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21221401/status")) {
        return new Response("<html>spa fallback</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.endsWith("/api/v1/serial/request")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
          request?: { method?: string };
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21221401");
        expect(body.request?.method).toBe("info");
        return jsonResponse({
          response: {
            ok: true,
            result: { device: { device_id: "f293cc9c139e" } },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendLocalUsbJsonlRequest(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      { id: 1, method: "info" },
    )) as { ok: boolean; result?: { device?: { device_id?: string } } };

    expect(response.ok).toBe(true);
    expect(response.result?.device?.device_id).toBe("f293cc9c139e");
  });
});
