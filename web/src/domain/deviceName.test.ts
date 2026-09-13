import { describe, expect, test } from "bun:test";
import type { DeviceInfoResponse } from "./deviceApi";
import {
  deviceNameBytes,
  deviceNameCacheFromInfo,
  resolveDeviceDisplayName,
  resolveStoredDeviceDisplayName,
  validateDeviceDisplayName,
} from "./deviceName";

function info(displayName?: string | null): DeviceInfoResponse {
  const device = {
    device_id: "aabbcc001122",
    hostname: "bench-hub",
    fqdn: "bench-hub.local",
    mac: "00:11:22:33:44:55",
    variant: "isolapurr-usb-hub",
    firmware: { name: "isolapurr-usb-hub", version: "0.1.0" },
    uptime_ms: 1,
    wifi: { state: "connected" as const, ipv4: null, is_static: false },
    ...(displayName === undefined ? {} : { display_name: displayName }),
  };
  return { device, capabilities: { device_name: true } };
}

describe("device display name", () => {
  test("resolves hardware, confirmed unset, and unknown states", () => {
    expect(
      resolveDeviceDisplayName({
        profileName: "Old local alias",
        hostname: "bench-hub",
        hardware: { state: "value", value: "Studio 猫" },
      }),
    ).toBe("Studio 猫");
    expect(
      resolveDeviceDisplayName({
        profileName: "Old local alias",
        hostname: "bench-hub",
        hardware: { state: "unset" },
      }),
    ).toBe("bench-hub");
    expect(
      resolveStoredDeviceDisplayName({
        id: "aabbcc001122",
        name: "Old local alias",
        hostname: "bench-hub",
        deviceNameCache: { state: "unknown" },
      }),
    ).toBe("Old local alias");
    expect(
      resolveStoredDeviceDisplayName({
        id: "aabbcc001122",
        name: "Old local alias",
        hostname: "bench-hub",
        deviceNameCache: { state: "unset" },
      }),
    ).toBe("bench-hub");
  });

  test("classifies missing, null, and string info fields", () => {
    expect(deviceNameCacheFromInfo(info())).toEqual({ state: "unknown" });
    expect(deviceNameCacheFromInfo(info(null))).toEqual({ state: "unset" });
    expect(deviceNameCacheFromInfo(info("Studio 猫"))).toEqual({
      state: "value",
      value: "Studio 猫",
    });
  });

  test("validates trimmed UTF-8 bytes and controls", () => {
    expect(validateDeviceDisplayName("  Studio 猫  ")).toBeNull();
    expect(deviceNameBytes("  猫  ")).toBe(
      new TextEncoder().encode("猫").length,
    );
    expect(validateDeviceDisplayName("猫".repeat(17))).toContain("48");
    expect(validateDeviceDisplayName("line\nname")).toContain("control");
  });
});
