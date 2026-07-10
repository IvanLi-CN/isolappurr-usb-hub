import { afterEach, describe, expect, test } from "bun:test";

import { readLocalUsbInfo } from "./AddDeviceDialog.helpers";

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
