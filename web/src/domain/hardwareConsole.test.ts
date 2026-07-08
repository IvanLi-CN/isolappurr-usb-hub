import { afterEach, describe, expect, test } from "bun:test";
import { DEMO_BUNDLED_FIRMWARE_MANIFEST } from "./firmwareBundle";
import {
  devdLocalUsbDeviceIdFromBaseUrl,
  filterEsp32SerialPorts,
  flashBundledWithLocalUsb,
  isEsp32SerialPort,
  listLocalUsbSerialPorts,
  sendDevdLocalUsbJsonlRequest,
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

describe("Local USB runtime power route", () => {
  test("maps power.runtime_set to the device runtime endpoint", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/devices/scan")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          devices: [
            {
              id: "usb--dev-cu-usbmodem21221401",
              usb: { portPath: "/dev/cu.usbmodem21221401" },
            },
          ],
        });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/runtime?owner=7",
        )
      ) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          action: "output",
          enabled: false,
          owner: 7,
        });
        return jsonResponse({
          ok: true,
          result: {
            runtime: {
              output_enabled: false,
              discharge_enabled: false,
            },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendDevdLocalUsbJsonlRequest(
      makeAgent(),
      "usb--dev-cu-usbmodem21221401",
      {
        id: 1,
        method: "power.runtime_set",
        params: { action: "output", enabled: false, owner: 7 },
      },
    )) as { ok: boolean; result?: { runtime?: { output_enabled?: boolean } } };

    expect(response.ok).toBe(true);
    expect(response.result?.runtime?.output_enabled).toBe(false);
  });
});

describe("flashBundledWithLocalUsb", () => {
  test("posts bundled catalog and selected asset to the new flash endpoint", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/firmware/releases/v0.5.1/isolapurr-usb-hub.app.bin")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (
        url.endsWith(
          "/firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
        )
      ) {
        return jsonResponse({
          schemaVersion: "1",
          artifacts: [
            {
              artifactId: "isolapurr-demo-051",
              target: "esp32s3_app",
              version: "v0.5.1",
              files: [
                {
                  kind: "app_bin",
                  path: "isolapurr-usb-hub.app.bin",
                  sha256: "abc",
                  size: 3,
                  flashAddress: 0x10000,
                },
              ],
            },
          ],
        });
      }
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
      if (url.endsWith("/api/v1/serial/lease")) {
        return jsonResponse({ lease_id: "lease-1" });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/flash-bundled",
        )
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.artifactId).toBe("isolapurr-demo-051");
        expect(body.fileKind).toBe("app_bin");
        expect(body.firstTime).toBe(false);
        expect(body.leaseId).toBe("lease-1");
        expect((body.catalog as { schemaVersion?: string }).schemaVersion).toBe(
          "1",
        );
        return jsonResponse({ ok: true, log: "done" });
      }
      if (url.endsWith("/api/v1/serial/lease/lease-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const release = DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0];
    if (!release) {
      throw new Error("missing demo release");
    }
    const log = await flashBundledWithLocalUsb(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      release,
      release.app,
      false,
      { deviceId: "aabbcc001122" },
    );

    expect(log).toBe("done");
  });

  test("sends elf recovery assets for first-time Local USB flash", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/firmware/releases/v0.5.1/isolapurr-usb-hub.elf")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (
        url.endsWith(
          "/firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
        )
      ) {
        return jsonResponse({
          schemaVersion: "1",
          artifacts: [
            {
              artifactId: "isolapurr-demo-051",
              target: "esp32s3_app",
              version: "v0.5.1",
              files: [
                {
                  kind: "elf",
                  path: "isolapurr-usb-hub.elf",
                  sha256: "abc",
                  size: 3,
                },
              ],
            },
          ],
        });
      }
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
      if (url.endsWith("/api/v1/serial/lease")) {
        return jsonResponse({ lease_id: "lease-1" });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/flash-bundled",
        )
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.fileKind).toBe("elf");
        expect(body.firstTime).toBe(true);
        expect(body.confirmNonProjectFirmware).toBe(true);
        expect(body.expectedIdentity).toEqual({
          deviceId: "aabbcc001122",
          mac: "AA:BB:CC:DD:EE:FF",
        });
        return jsonResponse({ ok: true, log: "done" });
      }
      if (url.endsWith("/api/v1/serial/lease/lease-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const release = DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0];
    if (!release?.recovery) {
      throw new Error("missing demo recovery release");
    }
    const log = await flashBundledWithLocalUsb(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      release,
      release.recovery,
      true,
      { deviceId: "aabbcc001122", mac: "AA:BB:CC:DD:EE:FF" },
      true,
    );

    expect(log).toBe("done");
  });
});
