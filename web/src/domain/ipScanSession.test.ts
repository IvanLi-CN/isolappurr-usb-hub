import { afterEach, describe, expect, test } from "bun:test";

import {
  classifyIpScanCompletion,
  createIpScanSession,
  IP_SCAN_SESSION_TTL_MS,
  isPersistableIpScanCompletion,
  loadIpScanSession,
  saveIpScanSession,
} from "./ipScanSession";

const originalWindow = globalThis.window;

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  return values;
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("IP scan session storage", () => {
  test("persists a completed scan when at least one host responded", () => {
    expect(
      classifyIpScanCompletion({
        reachableResponses: 1,
        browserBlockedRequests: 3,
      }),
    ).toBe("completed");
    expect(
      isPersistableIpScanCompletion({
        reachableResponses: 1,
        browserBlockedRequests: 3,
      }),
    ).toBe(true);
    expect(
      classifyIpScanCompletion({
        reachableResponses: 0,
        browserBlockedRequests: 3,
      }),
    ).toBe("browser_blocked");
    expect(
      classifyIpScanCompletion({
        reachableResponses: 0,
        browserBlockedRequests: 0,
      }),
    ).toBe("failed");
    expect(
      isPersistableIpScanCompletion({
        reachableResponses: 0,
        browserBlockedRequests: 3,
      }),
    ).toBe(false);
  });

  test("stores a completed scan with deduplicated devices", () => {
    installStorage();
    const session = createIpScanSession(
      "192.168.1.0/24",
      [
        { baseUrl: "http://192.168.1.2", device_id: "aabbcc001122" },
        { baseUrl: "http://192.168.1.3", device_id: "aabbcc001122" },
      ],
      1_000,
    );
    saveIpScanSession(false, session);

    expect(loadIpScanSession(false, 1_001)).toEqual({
      ...session,
      devices: [{ baseUrl: "http://192.168.1.3", device_id: "aabbcc001122" }],
    });
  });

  test("zero-result scans replace the previous session", () => {
    installStorage();
    saveIpScanSession(
      false,
      createIpScanSession(
        "192.168.1.0/24",
        [{ baseUrl: "http://192.168.1.2" }],
        1_000,
      ),
    );
    const empty = createIpScanSession("192.168.2.0/24", [], 2_000);
    saveIpScanSession(false, empty);

    expect(loadIpScanSession(false, 2_001)).toEqual(empty);
  });

  test("expires and removes the session on the next open", () => {
    const values = installStorage();
    saveIpScanSession(false, createIpScanSession("192.168.1.0/24", [], 1_000));

    expect(loadIpScanSession(false, 1_000 + IP_SCAN_SESSION_TTL_MS)).toBeNull();
    expect(values.has("isolapurr_usb_hub.ip_scan_session.v1.live")).toBe(false);
  });

  test("keeps live and demo sessions isolated", () => {
    installStorage();
    const live = createIpScanSession("192.168.1.0/24", [], 1_000);
    const demo = createIpScanSession("10.0.0.0/24", [], 1_000);
    saveIpScanSession(false, live);
    saveIpScanSession(true, demo);

    expect(loadIpScanSession(false, 1_001)?.cidr).toBe(live.cidr);
    expect(loadIpScanSession(true, 1_001)?.cidr).toBe(demo.cidr);
  });
});
