import { describe, expect, test } from "bun:test";

import {
  devdLocalUsbDeviceIdFromBaseUrl,
  filterEsp32SerialPorts,
  isEsp32SerialPort,
  stableLocalUsbDeviceId,
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

describe("stableLocalUsbDeviceId", () => {
  test("matches devd USB device id derivation", () => {
    expect(stableLocalUsbDeviceId("/dev/cu.usbmodem21221401")).toBe(
      "usb--dev-cu-usbmodem21221401",
    );
  });
});

describe("devdLocalUsbDeviceIdFromBaseUrl", () => {
  test("extracts CLI/devd USB profile ids", () => {
    expect(
      devdLocalUsbDeviceIdFromBaseUrl(
        "isolapurr-devd://usb--dev-cu-usbmodem21221401",
      ),
    ).toBe("usb--dev-cu-usbmodem21221401");
    expect(devdLocalUsbDeviceIdFromBaseUrl("http://192.168.4.1")).toBeNull();
  });
});
