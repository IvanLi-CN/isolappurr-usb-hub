import { afterEach, describe, expect, test } from "bun:test";
import {
  cacheWebSerialHardware,
  readCachedWebSerialHardware,
} from "./webSerialHardwareCache";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

afterEach(() => values.clear());

describe("Web Serial hardware cache", () => {
  test("reuses hardware truth only for the matching firmware MAC", () => {
    const hardware = {
      source: "esptool-js" as const,
      mcuModel: "ESP32-S3",
      flashSize: "4 MB",
      ramSize: "512 KB",
      macAddress: "9c:13:9e:f2:93:cc",
    };

    expect(cacheWebSerialHardware("9C:13:9E:F2:93:CC", hardware)).toBe(true);
    expect(readCachedWebSerialHardware("9c:13:9e:f2:93:cc")).toEqual(hardware);
    expect(readCachedWebSerialHardware("aa:bb:cc:dd:ee:ff")).toBeUndefined();
  });

  test("rejects hardware data whose MAC does not match firmware identity", () => {
    expect(
      cacheWebSerialHardware("9c:13:9e:f2:93:cc", {
        source: "esptool-js",
        mcuModel: "ESP32-S3",
        macAddress: "aa:bb:cc:dd:ee:ff",
      }),
    ).toBe(false);
    expect(readCachedWebSerialHardware("9c:13:9e:f2:93:cc")).toBeUndefined();
  });

  test("rejects persisted data whose embedded MAC does not match its cache key", () => {
    values.set(
      "isolapurr.web-serial-hardware.v1",
      JSON.stringify({
        "9c139ef293cc": {
          source: "esptool-js",
          mcuModel: "ESP32-S3",
          macAddress: "aa:bb:cc:dd:ee:ff",
        },
      }),
    );

    expect(readCachedWebSerialHardware("9c:13:9e:f2:93:cc")).toBeUndefined();
  });
});
