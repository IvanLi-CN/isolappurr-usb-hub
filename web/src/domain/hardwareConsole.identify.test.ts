import { afterEach, describe, expect, test } from "bun:test";
import { sendLocalUsbJsonlRequest } from "./hardwareConsole";

const originalFetch = globalThis.fetch;

function makeAgent() {
  return { token: "token", agentBaseUrl: "http://127.0.0.1:51200" };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Local USB identify route", () => {
  test("maps identify to the registered Local USB device endpoint", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/register")) {
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (
        url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21221401/identify")
      ) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          response: { ok: true, result: { accepted: true, duration_ms: 5000 } },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendLocalUsbJsonlRequest(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      { id: 1, method: "identify" },
    )) as {
      ok: boolean;
      result?: { accepted?: boolean; duration_ms?: number };
    };

    expect(response).toEqual({
      ok: true,
      result: { accepted: true, duration_ms: 5000 },
    });
  });
});
