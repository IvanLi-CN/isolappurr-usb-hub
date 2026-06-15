import { afterEach, describe, expect, test } from "bun:test";

import { setPowerConfig } from "./deviceApi";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as unknown as { window?: Window }).window = originalWindow;
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
