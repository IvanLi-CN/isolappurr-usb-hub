import { afterEach, describe, expect, test } from "bun:test";

import { getDeviceInfo, setPowerConfig } from "./deviceApi";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

function installWindow(origin = "https://isolapurr.ivanli.cc") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true,
      location: { origin },
      setTimeout,
      clearTimeout,
    },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("getDeviceInfo HTTP error classification", () => {
  test("classifies mDNS URL fetch failures as name/reachability", async () => {
    installWindow();
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const res = await getDeviceInfo(
      "http://isolapurr-usb-hub-aabbcc001122.local",
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected error");
    }
    expect(res.error.kind).toBe("name_resolution");
  });

  test("classifies secure-origin LAN fetch failures as browser blocked for IPv4", async () => {
    installWindow();
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const res = await getDeviceInfo("http://192.168.1.42");
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected error");
    }
    expect(res.error.kind).toBe("browser_blocked");
  });

  test("keeps timeout failures as offline", async () => {
    installWindow();
    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      throw new Error("unreachable");
    };

    const res = await getDeviceInfo("http://192.168.1.42");
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected error");
    }
    expect(res.error.kind).toBe("offline");
  });

  test("classifies mDNS timeout failures as name/reachability", async () => {
    installWindow();
    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      throw new Error("unreachable");
    };

    const res = await getDeviceInfo(
      "http://isolapurr-usb-hub-aabbcc001122.local",
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected error");
    }
    expect(res.error.kind).toBe("name_resolution");
  }, 8000);

  test("uses a longer timeout budget for mDNS URLs", async () => {
    installWindow();
    let abortDelayMs = 0;
    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      const startedAt = Date.now();
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          abortDelayMs = Date.now() - startedAt;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      throw new Error("unreachable");
    };

    const res = await getDeviceInfo(
      "http://isolapurr-usb-hub-aabbcc001122.local",
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected error");
    }
    expect(res.error.kind).toBe("name_resolution");
    expect(abortDelayMs).toBeGreaterThanOrEqual(6400);
  }, 8000);
});

describe("setPowerConfig", () => {
  test("omits read-only manual.path_policy from request payload", async () => {
    let bodyText = "";
    (globalThis as unknown as { window: unknown }).window = {
      isSecureContext: false,
      setTimeout,
      clearTimeout,
    } as unknown as Window;

    globalThis.fetch = async (_input, init) => {
      bodyText = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          hardware: "sw2303",
          persisted: true,
          tps_mode: "manual",
          light_load_mode: "fpwm",
          capability: {
            profile: "full",
            power_watts: 100,
            protocols: {
              pd: true,
              qc20: true,
              qc30: true,
              fcp: true,
              afc: true,
              scp: true,
              pe20: true,
              bc12: true,
              sfcp: true,
            },
            pd: {
              pps: true,
              fixed_voltages_mv: [9000, 12000, 15000, 20000],
            },
          },
          manual: {
            voltage_mv: 20000,
            current_limit_ma: 2900,
            usb_c_path_mode: "disconnect",
            path_policy: "force_close",
          },
          lock: null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const result = await setPowerConfig(
      "http://127.0.0.1:51233",
      {
        hardware: "sw2303",
        tps_mode: "manual",
        light_load_mode: "fpwm",
        capability: {
          profile: "full",
          power_watts: 100,
          protocols: {
            pd: true,
            qc20: true,
            qc30: true,
            fcp: true,
            afc: true,
            scp: true,
            pe20: true,
            bc12: true,
            sfcp: true,
          },
          pd: {
            pps: true,
            fixed_voltages_mv: [9000, 12000, 15000, 20000],
          },
        },
        manual: {
          voltage_mv: 20000,
          current_limit_ma: 2900,
          usb_c_path_mode: "disconnect",
          path_policy: "force_close",
        },
      } as Parameters<typeof setPowerConfig>[1],
      7,
    );

    expect(result.ok).toBe(true);
    expect(bodyText).toContain('"usb_c_path_mode":"disconnect"');
    expect(bodyText).not.toContain("path_policy");
  });
});
