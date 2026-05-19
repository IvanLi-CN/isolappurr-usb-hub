import { describe, expect, test } from "bun:test";

import {
  buildLocalUsbFlashRequestBody,
  DEFAULT_LOCAL_USB_FLASH_ADDRESS,
  filterEsp32SerialPorts,
  isEsp32SerialPort,
} from "./hardwareConsole";

describe("isEsp32SerialPort", () => {
  test("accepts ESP32-S3 USB Serial/JTAG by USB metadata across platforms", () => {
    expect(
      isEsp32SerialPort({
        path: "COM3",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      }),
    ).toBe(true);
    expect(
      isEsp32SerialPort({
        path: "/dev/ttyACM0",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      }),
    ).toBe(true);
  });

  test("keeps unrelated local ports out of Local USB choices", () => {
    expect(
      isEsp32SerialPort({
        path: "/dev/cu.Bluetooth-Incoming-Port",
        label: "Bluetooth-Incoming-Port",
      }),
    ).toBe(false);
    expect(
      isEsp32SerialPort({
        path: "/dev/cu.debug-console",
        label: "debug console",
      }),
    ).toBe(false);
  });
});

describe("filterEsp32SerialPorts", () => {
  test("dedupes tty/cu pairs after filtering ESP32 candidates", () => {
    const ports = filterEsp32SerialPorts([
      {
        path: "/dev/tty.usbmodem21221401",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      },
      {
        path: "/dev/cu.usbmodem21221401",
        label: "USB JTAG/serial debug unit",
        vendorId: 0x303a,
        productId: 0x1001,
      },
    ]);

    expect(ports).toHaveLength(1);
    expect(ports[0]?.path).toBe("/dev/cu.usbmodem21221401");
  });
});

describe("buildLocalUsbFlashRequestBody", () => {
  test("pins Local USB firmware updates to app image identity semantics", () => {
    expect(
      buildLocalUsbFlashRequestBody({
        portPath: "/dev/cu.usbmodem21221401",
        address: DEFAULT_LOCAL_USB_FLASH_ADDRESS,
        fileName: "isolapurr-usb-hub.app.bin",
        fileBase64: "AA==",
        expectedIdentity: {
          deviceId: "f293cc",
          mac: "aa:bb:cc:dd:ee:ff",
        },
      }),
    ).toEqual({
      portPath: "/dev/cu.usbmodem21221401",
      address: 0x10000,
      fileName: "isolapurr-usb-hub.app.bin",
      fileBase64: "AA==",
      expectedIdentity: {
        deviceId: "f293cc",
        mac: "aa:bb:cc:dd:ee:ff",
      },
    });
  });
});
