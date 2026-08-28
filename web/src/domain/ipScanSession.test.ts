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
  const localValues = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  const makeStorage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: makeStorage(localValues),
      sessionStorage: makeStorage(sessionValues),
    },
  });
  return { localValues, sessionValues };
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
    const { localValues } = installStorage();
    saveIpScanSession(false, createIpScanSession("192.168.1.0/24", [], 1_000));

    expect(loadIpScanSession(false, 1_000 + IP_SCAN_SESSION_TTL_MS)).toBeNull();
    expect(localValues.has("isolapurr_usb_hub.ip_scan_session.v1.live")).toBe(
      false,
    );
  });

  test("rejects malformed or future expiry timestamps", () => {
    const { localValues } = installStorage();
    const key = "isolapurr_usb_hub.ip_scan_session.v1.live";
    const completedAt = 1_000;
    localValues.set(
      key,
      JSON.stringify({
        version: 1,
        cidr: "192.168.1.0/24",
        devices: [],
        completedAt,
        expiresAt: completedAt + IP_SCAN_SESSION_TTL_MS - 1,
      }),
    );
    expect(loadIpScanSession(false, 1_001)).toBeNull();

    localValues.set(
      key,
      JSON.stringify({
        version: 1,
        cidr: "192.168.1.0/24",
        devices: { baseUrl: "http://192.168.1.2" },
        completedAt: 3_000,
        expiresAt: 3_000 + IP_SCAN_SESSION_TTL_MS,
      }),
    );
    expect(loadIpScanSession(false, 3_001)).toBeNull();

    localValues.set(
      key,
      JSON.stringify({
        version: 1,
        cidr: "192.168.1.0/24",
        devices: [{ device_id: "missing-base-url" }],
        completedAt: 4_000,
        expiresAt: 4_000 + IP_SCAN_SESSION_TTL_MS,
      }),
    );
    expect(loadIpScanSession(false, 4_001)).toBeNull();

    localValues.set(
      key,
      JSON.stringify({
        version: 1,
        cidr: "192.168.1.0/24",
        devices: [],
        completedAt: 2_000,
        expiresAt: 2_000 + IP_SCAN_SESSION_TTL_MS,
      }),
    );
    expect(loadIpScanSession(false, 1_001)).toBeNull();
  });

  test("keeps live and demo sessions isolated", () => {
    const { localValues, sessionValues } = installStorage();
    const live = createIpScanSession("192.168.1.0/24", [], 1_000);
    const demo = createIpScanSession("10.0.0.0/24", [], 1_000);
    saveIpScanSession(false, live);
    saveIpScanSession(true, demo);

    expect(loadIpScanSession(false, 1_001)?.cidr).toBe(live.cidr);
    expect(loadIpScanSession(true, 1_001)?.cidr).toBe(demo.cidr);
    expect(localValues.has("isolapurr_usb_hub.ip_scan_session.v1.demo")).toBe(
      false,
    );
    expect(sessionValues.has("isolapurr_usb_hub.ip_scan_session.v1.demo")).toBe(
      true,
    );
  });

  test("treats storage read failures as an unavailable cache", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    } as unknown as Storage;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage, sessionStorage: storage },
    });

    expect(loadIpScanSession(false)).toBeNull();
  });
});
