import { describe, expect, test } from "bun:test";
import type { SerialLikePort } from "../domain/hardwareConsole";
import { hardwareFromFirmwareInfo } from "./firmwareFlashShared";

const projectInfo = (hardware?: Record<string, unknown>) => ({
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
  },
});

const esp32S3Port = {
  getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
} as SerialLikePort;

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
