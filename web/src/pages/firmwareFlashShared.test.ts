import { describe, expect, test } from "bun:test";
import type { SerialLikePort } from "../domain/hardwareConsole";
import {
  classifyProbe,
  formatFirmwareVersion,
  hardwareFromFirmwareInfo,
} from "./firmwareFlashShared";

const projectInfo = (
  hardware?: Record<string, unknown>,
  capabilities?: { identify: boolean },
) => ({
  id: 1,
  ok: true,
  result: {
    device: {
      device_id: "f293cc9c139e",
      mac: "9c:13:9e:f2:93:cc",
      variant: "tps-sw",
      firmware: { name: "isolapurr-usb-hub", version: "0.5.1" },
      ...(hardware ? { hardware } : {}),
    },
    ...(capabilities ? { capabilities } : {}),
  },
});

const esp32S3Port = {
  getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
} as SerialLikePort;

describe("formatFirmwareVersion", () => {
  test("adds one canonical v prefix", () => {
    expect(formatFirmwareVersion("0.5.1")).toBe("v0.5.1");
    expect(formatFirmwareVersion("v0.5.1")).toBe("v0.5.1");
    expect(formatFirmwareVersion("V0.5.1")).toBe("v0.5.1");
  });
});

describe("hardwareFromFirmwareInfo", () => {
  test("uses hardware values reported by project firmware", () => {
    expect(
      hardwareFromFirmwareInfo(
        projectInfo({
          mcu: "ESP32-S3",
          flash_bytes: 4 * 1024 * 1024,
          ram_bytes: 512 * 1024,
          psram_bytes: 8 * 1024 * 1024,
        }),
        esp32S3Port,
      ),
    ).toEqual({
      source: "firmware",
      chipType: "ESP32-S3",
      mcuModel: "ESP32-S3",
      flashSize: "4 MB",
      ramSize: "512 KB",
      psramSize: "8 MB",
      macAddress: "9c:13:9e:f2:93:cc",
    });
  });

  test("uses the legacy tps-sw profile only with matching ESP32-S3 USB ids", () => {
    expect(hardwareFromFirmwareInfo(projectInfo(), esp32S3Port)).toEqual({
      source: "firmware-profile",
      chipType: "ESP32-S3",
      mcuModel: "ESP32-S3",
      flashSize: "4 MB",
      ramSize: "512 KB",
      psramSize: "8 MB",
      macAddress: "9c:13:9e:f2:93:cc",
    });
    expect(hardwareFromFirmwareInfo(projectInfo(), null)).toBeUndefined();
  });

  test("does not infer hardware for non-project firmware", () => {
    const value = projectInfo();
    value.result.device.firmware.name = "other-firmware";
    expect(hardwareFromFirmwareInfo(value, esp32S3Port)).toBeUndefined();
  });
});

describe("classifyProbe", () => {
  test("preserves explicit identify capability from the selected USB target", () => {
    const value = projectInfo(undefined, { identify: true });
    expect(classifyProbe(value, "missing metadata")).toMatchObject({
      kind: "recognized",
      capabilities: { identify: true },
    });
  });

  test("does not infer identify support when the capability is absent", () => {
    expect(classifyProbe(projectInfo(), "missing metadata").capabilities).toBe(
      undefined,
    );
  });
});
