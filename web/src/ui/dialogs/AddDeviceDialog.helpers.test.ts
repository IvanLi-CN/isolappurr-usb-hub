import { afterEach, describe, expect, test } from "bun:test";

import {
  isPersistableDesktopScan,
  parseDesktopDiscoverySnapshot,
  parseDesktopIpScanRunId,
  readLocalUsbInfo,
} from "./AddDeviceDialog.helpers";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("readLocalUsbInfo", () => {
  test("reads Local USB info through the registered device status route", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/register")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21231401");
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21231401",
            usb: { portPath: "/dev/cu.usbmodem21231401" },
          },
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21231401/status")) {
        return jsonResponse({
          ok: true,
          result: {
            device: {
              mac: "9c:13:9e:f2:93:cc",
            },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const value = (await readLocalUsbInfo(
      {
        token: "token",
        agentBaseUrl: "http://127.0.0.1:51200",
      },
      {
        path: "/dev/cu.usbmodem21231401",
        label: "USB JTAG/serial debug unit",
      },
      () => undefined,
    )) as {
      ok?: boolean;
      result?: { device?: { mac?: string } };
    };

    expect(value.ok).toBe(true);
    expect(value.result?.device?.mac).toBe("9c:13:9e:f2:93:cc");
  });

  test("retries Local USB info without scanning other devices", async () => {
    let attempts = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/register")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21231401");
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21231401",
            usb: { portPath: "/dev/cu.usbmodem21231401" },
          },
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21231401/status")) {
        attempts += 1;
        return jsonResponse(
          {
            error: {
              message: "device did not respond to IsolaPurr `info`",
            },
          },
          { status: 500 },
        );
      }
      if (url.endsWith("/api/v1/devices/scan")) {
        throw new Error("unexpected device scan");
      }
      throw new Error(`unexpected request: ${url}`);
    };

    await expect(
      readLocalUsbInfo(
        {
          token: "token",
          agentBaseUrl: "http://127.0.0.1:51200",
        },
        {
          path: "/dev/cu.usbmodem21231401",
          label: "USB JTAG/serial debug unit",
        },
        () => undefined,
      ),
    ).rejects.toThrow("device did not respond to IsolaPurr `info`");
    expect(attempts).toBe(3);
  });
});

describe("desktop discovery scan ownership", () => {
  test("parses a run id and scan-owned devices separately", () => {
    expect(parseDesktopIpScanRunId({ runId: 9 })).toBe(9);
    expect(parseDesktopIpScanRunId({ runId: 0 })).toBeNull();

    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [{ baseUrl: "http://service.local", device_id: "aabbcc001122" }],
      scan: {
        cidr: "192.168.1.0/24",
        done: 254,
        total: 254,
        status: "ready",
        runId: 9,
        devices: [{ baseUrl: "http://192.168.1.2", device_id: "ddeeff001122" }],
      },
    });

    expect(parsed?.devices).toHaveLength(1);
    expect(parsed?.scan?.devices).toHaveLength(1);
    expect(parsed?.scan?.runId).toBe(9);
    expect(parsed?.scan?.status).toBe("ready");
  });

  test("recognizes completed legacy desktop scans", () => {
    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [{ baseUrl: "http://192.168.1.2", device_id: "ddeeff001122" }],
      scan: {
        cidr: "192.168.1.0/24",
        done: 254,
        total: 254,
      },
    });

    expect(parsed?.scan?.status).toBe("ready");
    expect(parsed?.scan?.devices).toHaveLength(1);
    expect(parsed?.scan?.legacyDevicesAreAmbiguous).toBe(true);
  });

  test("keeps an empty legacy scan persistable when service discovery is empty", () => {
    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [],
      scan: {
        cidr: "192.168.1.0/24",
        done: 254,
        total: 254,
      },
    });

    expect(parsed?.scan?.status).toBe("ready");
    expect(parsed?.scan?.devices).toHaveLength(0);
    expect(parsed?.scan?.legacyDevicesAreAmbiguous).toBe(false);
    expect(isPersistableDesktopScan(parsed?.scan)).toBe(true);
  });

  test("requires trusted response metrics for non-empty desktop scans", () => {
    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [],
      scan: {
        cidr: "192.168.1.0/24",
        done: 254,
        total: 254,
        status: "ready",
        devices: [{ baseUrl: "http://192.168.1.2" }],
      },
    });

    expect(isPersistableDesktopScan(parsed?.scan)).toBe(false);
    expect(
      isPersistableDesktopScan({
        ...parsed?.scan,
        reachableResponses: 1,
      }),
    ).toBe(true);
  });

  test("keeps an explicitly scanning desktop scan in progress", () => {
    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [{ baseUrl: "http://192.168.1.2" }],
      scan: {
        cidr: "192.168.1.0/24",
        done: 254,
        total: 254,
        status: "scanning",
      },
    });

    expect(parsed?.scan?.status).toBe("scanning");
  });

  test("rejects a desktop scan with an invalid CIDR", () => {
    const parsed = parseDesktopDiscoverySnapshot({
      mode: "service",
      status: "ready",
      devices: [],
      scan: {
        cidr: "not-a-cidr",
        done: 1,
        total: 1,
        status: "ready",
        reachableResponses: 1,
      },
    });

    expect(parsed?.scan).toBeUndefined();
  });
});
