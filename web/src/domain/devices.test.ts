import { describe, expect, test } from "bun:test";

import {
  DEVICES_STORAGE_KEY,
  isLegacyDeviceId,
  loadStoredDevices,
  mergeStoredDeviceTransports,
  normalizeBaseUrl,
  normalizeDeviceIdPrefix,
  normalizeStoredDeviceId,
  preferVerifiedHttpBaseUrl,
  validateAddDeviceDraftInput,
  validateAddDeviceInput,
} from "./devices";

const originalWindow = globalThis.window;

function installWindowWithLocalStorage(store: Map<string, string>) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
}

describe("normalizeBaseUrl", () => {
  test("requires a valid http/https url", () => {
    expect(normalizeBaseUrl("")).toEqual({
      ok: false,
      error: "Base URL is required",
    });
    expect(normalizeBaseUrl("not a url")).toEqual({
      ok: false,
      error: "Base URL must be a valid URL",
    });
    expect(normalizeBaseUrl("ftp://example.com")).toEqual({
      ok: false,
      error: "Base URL must start with http:// or https://",
    });
  });

  test("normalizes to origin", () => {
    const result = normalizeBaseUrl("http://example.com/foo/bar");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.baseUrl).toBe("http://example.com");
  });
});

describe("validateAddDeviceInput", () => {
  test("requires name and baseUrl", () => {
    const res = validateAddDeviceInput({ name: "", baseUrl: "" });
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected errors");
    }
    expect(res.errors.name).toBeDefined();
    expect(res.errors.baseUrl).toBeDefined();
  });

  test("rejects duplicate id", () => {
    const res = validateAddDeviceInput(
      { name: "A", baseUrl: "http://example.com", id: "aabbcc001122" },
      ["aabbcc001122"],
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected errors");
    }
    expect(res.errors.id).toBe("ID already exists");
  });

  test("rejects duplicate baseUrl", () => {
    const res = validateAddDeviceInput(
      { name: "A", baseUrl: "http://example.com" },
      [],
      ["http://example.com"],
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected errors");
    }
    expect(res.errors.baseUrl).toBe("Base URL already exists");
  });

  test("requires device_id when missing", () => {
    const res = validateAddDeviceInput({
      name: "A",
      baseUrl: "http://example.com",
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected errors");
    }
    expect(res.errors.id).toBe("device_id is required");
  });

  test("allows demo-mode drafts to omit device_id", () => {
    const res = validateAddDeviceDraftInput(
      {
        name: "A",
        baseUrl: "http://example.com/path",
        id: "   ",
      },
      [],
      [],
      { allowMissingId: true },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error("expected ok");
    }
    expect(res.input).toEqual({
      name: "A",
      baseUrl: "http://example.com",
      id: undefined,
      transports: undefined,
    });
  });

  test("accepts canonical 12-char lowercase hex device_id", () => {
    const res = validateAddDeviceInput({
      name: "A",
      baseUrl: "http://example.com",
      id: "aabbcc001122",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error("expected ok");
    }
    expect(res.device.id).toBe("aabbcc001122");
  });

  test("rejects legacy 6-char device_id", () => {
    const res = validateAddDeviceInput({
      name: "A",
      baseUrl: "http://example.com",
      id: "aabbcc",
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected errors");
    }
    expect(res.errors.id).toContain("Legacy 6-digit");
  });
});

describe("device_id helpers", () => {
  test("normalizes only canonical full device_id values", () => {
    expect(normalizeStoredDeviceId("AABBCC001122")).toBe("aabbcc001122");
    expect(normalizeStoredDeviceId("aabbcc")).toBeNull();
    expect(normalizeStoredDeviceId("not-an-id")).toBeNull();
  });

  test("detects legacy ids and valid prefixes", () => {
    expect(isLegacyDeviceId("aabbcc")).toBe(true);
    expect(isLegacyDeviceId("aabbcc001122")).toBe(false);
    expect(normalizeDeviceIdPrefix("AABBCC")).toBe("aabbcc");
    expect(normalizeDeviceIdPrefix("aabbcc001122")).toBe("aabbcc001122");
    expect(normalizeDeviceIdPrefix("xyz")).toBeNull();
  });
});

describe("mergeStoredDeviceTransports", () => {
  test("preserves saved channels when upsert input only updates one transport", () => {
    expect(
      mergeStoredDeviceTransports(
        {
          httpBaseUrl: "http://old.local",
          localUsbPortPath: "/dev/cu.usbmodem101",
          webSerialLabel: "ESP32-S3 USB JTAG",
        },
        {
          httpBaseUrl: "http://new.local/info",
        },
      ),
    ).toEqual({
      httpBaseUrl: "http://new.local",
      localUsbPortPath: "/dev/cu.usbmodem101",
      webSerialLabel: "ESP32-S3 USB JTAG",
    });
  });
});

describe("preferVerifiedHttpBaseUrl", () => {
  test("rebinds saved mDNS URLs to the verified IPv4 LAN path", () => {
    expect(
      preferVerifiedHttpBaseUrl(
        {
          id: "f293cc9c139e",
          name: "Bench Hub",
          baseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
          transports: {
            httpBaseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
            localUsbPortPath: "/dev/cu.usbmodem101",
          },
        },
        "http://192.168.31.224",
      ),
    ).toEqual({
      id: "f293cc9c139e",
      name: "Bench Hub",
      baseUrl: "http://192.168.31.224",
      transports: {
        httpBaseUrl: "http://192.168.31.224",
        localUsbPortPath: "/dev/cu.usbmodem101",
      },
    });
  });
});

describe("loadStoredDevices", () => {
  test("prunes invalid records while preserving canonical saved devices", () => {
    const store = new Map<string, string>();
    installWindowWithLocalStorage(store);

    store.set(
      DEVICES_STORAGE_KEY,
      JSON.stringify([
        {
          id: "f293cc",
          name: "Legacy",
          baseUrl: "http://legacy.local",
        },
        {
          id: "f293cc9c139e",
          name: "Canonical",
          baseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
        },
      ]),
    );

    const devices = loadStoredDevices();

    expect(devices).toEqual([
      {
        id: "f293cc9c139e",
        name: "Canonical",
        baseUrl: "http://isolapurr-usb-hub-f293cc9c139e.local",
        transports: undefined,
      },
    ]);
    expect(JSON.parse(store.get(DEVICES_STORAGE_KEY) ?? "[]")).toHaveLength(1);

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });
});
