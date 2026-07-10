import { afterEach, describe, expect, mock, test } from "bun:test";
import { DEMO_BUNDLED_FIRMWARE_MANIFEST } from "./firmwareBundle";
import {
  devdLocalUsbDeviceIdFromBaseUrl,
  filterEsp32SerialPorts,
  flashBundledWithLocalUsb,
  flashWithWebSerial,
  forgetGrantedWebSerialPort,
  getReusableGrantedWebSerialPort,
  isEsp32SerialPort,
  listLocalUsbSerialPorts,
  parseWebSerialJsonLine,
  probeWebSerialBoard,
  refreshGrantedWebSerialPort,
  requestWebSerialPort,
  sendDevdLocalUsbJsonlRequest,
  sendLocalUsbJsonlRequest,
  stableLocalUsbDeviceId,
  WebSerialJsonlTransport,
} from "./hardwareConsole";

const originalFetch = globalThis.fetch;
const originalNavigator = globalThis.navigator;

function makeAgent() {
  return { token: "token", agentBaseUrl: "http://127.0.0.1:51200" };
}

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  }
});

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

describe("parseWebSerialJsonLine", () => {
  test("parses a clean JSONL response line", () => {
    expect(parseWebSerialJsonLine('{"id":1,"ok":true}')).toEqual({
      id: 1,
      ok: true,
    });
  });

  test("salvages a JSON payload after serial noise", () => {
    expect(parseWebSerialJsonLine('boot:ok {"id":7,"result":"ready"}')).toEqual(
      {
        id: 7,
        result: "ready",
      },
    );
  });

  test("ignores non-JSON boot chatter", () => {
    expect(parseWebSerialJsonLine("rst:0x1 (POWERON),boot:0x8")).toBeNull();
  });
});

describe("WebSerialJsonlTransport probe deadlines", () => {
  test("closes a port whose open call outlives the probe deadline", async () => {
    let closeCalls = 0;
    const port = {
      readable: null,
      writable: null,
      open: () => new Promise<void>(() => undefined),
      close: async () => {
        closeCalls += 1;
      },
    };
    const transport = new WebSerialJsonlTransport();
    const startedAt = performance.now();

    await expect(
      transport.connectToPort(port as never, {
        deadlineAt: Date.now() + 50,
      }),
    ).rejects.toThrow("probe timed out");

    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(closeCalls).toBe(1);
  });

  test("aborts a pending firmware request and ignores a late frame", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      open: async () => {
        port.readable = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        });
        port.writable = new WritableStream<Uint8Array>();
      },
      close: async () => undefined,
    };
    const abort = new AbortController();
    const transport = new WebSerialJsonlTransport();
    await transport.connectToPort(port as never);
    const request = transport.request(
      { id: 7, method: "info", timeoutMs: 5_000 },
      { signal: abort.signal, deadlineAt: Date.now() + 5_000 },
    );

    abort.abort(new Error("Probe timed out."));
    await expect(request).rejects.toThrow("Probe timed out.");
    expect(() => {
      controller?.enqueue(new TextEncoder().encode('{"id":7,"result":{}}\n'));
    }).not.toThrow();
    await transport.disconnect();
  });
});

describe("refreshGrantedWebSerialPort", () => {
  test("prefers the single granted port after probe reconnect", async () => {
    const stalePort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const freshPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [freshPort],
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(refreshGrantedWebSerialPort(stalePort as never)).resolves.toBe(
      freshPort,
    );
  });

  test(
    "fails when multiple granted ports remain ambiguous",
    { timeout: 8_000 },
    async () => {
      const stalePort = {
        readable: null,
        writable: null,
        close: async () => undefined,
        open: async () => undefined,
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      };
      const portA = {
        readable: null,
        writable: null,
        close: async () => undefined,
        open: async () => undefined,
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      };
      const portB = {
        readable: null,
        writable: null,
        close: async () => undefined,
        open: async () => undefined,
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      };

      Object.defineProperty(globalThis, "navigator", {
        value: {
          serial: {
            getPorts: async () => [portA, portB],
          },
        },
        configurable: true,
        writable: true,
      });

      await expect(
        refreshGrantedWebSerialPort(stalePort as never),
      ).rejects.toThrow(
        "Browser granted Web USB ports are ambiguous or unavailable.",
      );
    },
  );

  test("waits for a re-enumerated port object instead of reusing the stale handle immediately", async () => {
    const stalePort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const freshPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    let attempts = 0;

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => {
            attempts += 1;
            return attempts < 3 ? [stalePort] : [freshPort];
          },
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(refreshGrantedWebSerialPort(stalePort as never)).resolves.toBe(
      freshPort,
    );
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  test("stops re-enumeration polling at the probe deadline", async () => {
    const stalePort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [stalePort],
        },
      },
      configurable: true,
      writable: true,
    });

    const startedAt = performance.now();
    await expect(
      refreshGrantedWebSerialPort(stalePort as never, {
        deadlineAt: Date.now() + 60,
      }),
    ).rejects.toThrow("probe timed out");
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});

describe("forgetGrantedWebSerialPort", () => {
  test("forgets the refreshed granted port when browser revoke is supported", async () => {
    const stalePort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const calls: string[] = [];
    const freshPort = {
      readable: null,
      writable: null,
      close: async () => {
        calls.push("close");
      },
      forget: async () => {
        calls.push("forget");
      },
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [freshPort],
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(forgetGrantedWebSerialPort(stalePort as never)).resolves.toBe(
      true,
    );
    expect(calls).toEqual(["close", "forget"]);
  });

  test("returns false when browser revoke is unavailable", async () => {
    const port = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [port],
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(forgetGrantedWebSerialPort(port as never)).resolves.toBe(
      false,
    );
  });
});

describe("requestWebSerialPort", () => {
  test("reuses the preferred granted port when multiple browser ports are already authorized", async () => {
    const preferredPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const otherPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    };
    const requestPort = mock(async () => {
      throw new Error("chooser should not open");
    });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [otherPort, preferredPort],
          requestPort,
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(
      getReusableGrantedWebSerialPort(preferredPort as never),
    ).resolves.toBe(preferredPort);
    await expect(requestWebSerialPort(preferredPort as never)).resolves.toBe(
      preferredPort,
    );
    expect(requestPort).not.toHaveBeenCalled();
  });

  test("reuses the single granted browser port before opening the chooser", async () => {
    const grantedPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const requestPort = mock(async () => {
      throw new Error("chooser should not open");
    });

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [grantedPort],
          requestPort,
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(requestWebSerialPort()).resolves.toBe(grantedPort);
    expect(requestPort).not.toHaveBeenCalled();
  });

  test("falls back to the chooser when granted ports are ambiguous", async () => {
    const portA = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const portB = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const chosenPort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const requestPort = mock(async () => chosenPort);

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {
          getPorts: async () => [portA, portB],
          requestPort,
        },
      },
      configurable: true,
      writable: true,
    });

    await expect(requestWebSerialPort()).resolves.toBe(chosenPort);
    expect(requestPort).toHaveBeenCalledTimes(1);
  });
});

describe("probeWebSerialBoard", () => {
  test("disconnects the esptool transport before returning the granted port to later flash steps", async () => {
    const cleanupCalls = {
      disconnect: 0,
      portClose: 0,
      loaderAfter: 0,
      detectChip: 0,
      loaderMain: 0,
      setDTR: 0,
      setRTS: 0,
      tracingEnabled: null as boolean | null,
    };
    const fakePort = {
      readable: null,
      writable: null,
      close: async () => {
        cleanupCalls.portClose += 1;
      },
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };

    class FakeTransport {
      constructor(
        readonly device: typeof fakePort,
        readonly _enableTracing: boolean,
      ) {
        cleanupCalls.tracingEnabled = _enableTracing;
      }

      async disconnect() {
        cleanupCalls.disconnect += 1;
      }

      async setDTR(_value: boolean) {
        cleanupCalls.setDTR += 1;
      }

      async setRTS(_value: boolean) {
        cleanupCalls.setRTS += 1;
      }
    }

    class FakeLoader {
      readonly chip = {
        getChipDescription: async () => "ESP32-S3 (revision v0.2)",
        getChipFeatures: async () => ["Wi-Fi", "BLE"],
        readMac: async () => "9c:13:9e:f2:93:cc",
        getCrystalFreq: async () => 40,
        postConnect: async () => undefined,
      };
      readonly ESP_MEM_END = 0;

      constructor(readonly _options: unknown) {}

      _appendArray(left: Uint8Array, right: Uint8Array) {
        return new Uint8Array([...left, ...right]);
      }

      _intToByteArray(value: number) {
        return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
      }

      async checkCommand() {
        return undefined;
      }

      async memFinish() {
        return undefined;
      }

      async detectChip() {
        cleanupCalls.detectChip += 1;
        return "ESP32-S3";
      }

      async main() {
        cleanupCalls.loaderMain += 1;
        throw new Error("Full esptool initialization must not run for probe.");
      }

      async detectFlashSize() {
        return "4MB";
      }

      async after() {
        cleanupCalls.loaderAfter += 1;
      }
    }

    mock.module("esptool-js", () => ({
      ESPLoader: FakeLoader,
      Transport: FakeTransport,
    }));

    const board = await probeWebSerialBoard(fakePort as never);

    expect(board.mcuModel).toBe("ESP32-S3");
    expect(cleanupCalls.detectChip).toBe(1);
    expect(cleanupCalls.loaderMain).toBe(0);
    expect(cleanupCalls.tracingEnabled).toBe(false);
    expect(cleanupCalls.loaderAfter).toBe(1);
    expect(cleanupCalls.setDTR).toBeGreaterThan(0);
    expect(cleanupCalls.setRTS).toBeGreaterThan(0);
    expect(cleanupCalls.disconnect).toBe(1);
    expect(cleanupCalls.portClose).toBe(0);
  });
});

describe("flashWithWebSerial", () => {
  test("retries transient browser serial open failures during flash", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "firmware.bin", {
      type: "application/octet-stream",
    });
    const fakePort = {
      readable: null,
      writable: null,
      close: async () => undefined,
      open: async () => undefined,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    };
    const calls = {
      disconnect: 0,
      main: 0,
      writeFlash: 0,
      after: 0,
      setDTR: 0,
      setRTS: 0,
    };

    class FakeTransport {
      constructor(
        readonly _device: typeof fakePort,
        readonly _enableTracing: boolean,
      ) {}

      async disconnect() {
        calls.disconnect += 1;
      }

      async setDTR(_value: boolean) {
        calls.setDTR += 1;
      }

      async setRTS(_value: boolean) {
        calls.setRTS += 1;
      }
    }

    class FakeLoader {
      readonly ESP_MEM_END = 0;

      constructor(readonly _options: unknown) {}

      _appendArray(left: Uint8Array, right: Uint8Array) {
        return new Uint8Array([...left, ...right]);
      }

      _intToByteArray(value: number) {
        return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
      }

      async checkCommand() {
        return undefined;
      }

      async memFinish() {
        return undefined;
      }

      async main() {
        calls.main += 1;
        if (calls.main === 1) {
          throw new DOMException(
            "Failed to execute 'open' on 'SerialPort': Failed to open serial port.",
          );
        }
        return "ESP32-S3";
      }

      async writeFlash() {
        calls.writeFlash += 1;
        return undefined;
      }

      async after() {
        calls.after += 1;
        return undefined;
      }
    }

    mock.module("esptool-js", () => ({
      ESPLoader: FakeLoader,
      Transport: FakeTransport,
    }));

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serial: {},
      },
      configurable: true,
      writable: true,
    });

    await expect(
      flashWithWebSerial(fakePort as never, file, 0x10000, () => undefined),
    ).resolves.toBeUndefined();
    expect(calls.main).toBe(2);
    expect(calls.writeFlash).toBe(1);
    expect(calls.after).toBe(1);
    expect(calls.disconnect).toBe(2);
  });
});

describe("Local USB direct bridge routes", () => {
  test("reads Local USB port choices from serial ports without scanning devices", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/ports")) {
        return jsonResponse({
          ports: [
            {
              portPath: "/dev/cu.usbmodem21221401",
              label: "USB JTAG/serial debug unit",
              vendorId: 0x303a,
              productId: 0x1001,
            },
          ],
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const ports = await listLocalUsbSerialPorts(makeAgent());
    expect(ports).toHaveLength(1);
    expect(ports[0]?.path).toBe("/dev/cu.usbmodem21221401");
  });

  test("registers the selected Local USB device before using serial request fallback", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/register")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          portPath: "/dev/cu.usbmodem21221401",
        });
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21221401/status")) {
        return new Response(null, { status: 405 });
      }
      if (url.endsWith("/api/v1/serial/request")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
          request?: { method?: string };
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21221401");
        expect(body.request?.method).toBe("info");
        return jsonResponse({
          response: {
            ok: true,
            result: { device: { device_id: "f293cc9c139e" } },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendLocalUsbJsonlRequest(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      { id: 1, method: "info" },
    )) as { ok: boolean; result?: { device?: { device_id?: string } } };

    expect(response.ok).toBe(true);
    expect(response.result?.device?.device_id).toBe("f293cc9c139e");
  });

  test("falls back to legacy serial request when the registered device status returns non-json 200", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/serial/register")) {
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (url.endsWith("/api/v1/devices/usb--dev-cu-usbmodem21221401/status")) {
        return new Response("<html>spa fallback</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.endsWith("/api/v1/serial/request")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          portPath?: string;
          request?: { method?: string };
        };
        expect(body.portPath).toBe("/dev/cu.usbmodem21221401");
        expect(body.request?.method).toBe("info");
        return jsonResponse({
          response: {
            ok: true,
            result: { device: { device_id: "f293cc9c139e" } },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendLocalUsbJsonlRequest(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      { id: 1, method: "info" },
    )) as { ok: boolean; result?: { device?: { device_id?: string } } };

    expect(response.ok).toBe(true);
    expect(response.result?.device?.device_id).toBe("f293cc9c139e");
  });
});

describe("Local USB runtime power route", () => {
  test("maps power.runtime_set to the device runtime endpoint", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/v1/devices/scan")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          devices: [
            {
              id: "usb--dev-cu-usbmodem21221401",
              usb: { portPath: "/dev/cu.usbmodem21221401" },
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/serial/register")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          portPath: "/dev/cu.usbmodem21221401",
        });
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/runtime?owner=7",
        )
      ) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
          action: "output",
          enabled: false,
          owner: 7,
        });
        return jsonResponse({
          ok: true,
          result: {
            runtime: {
              output_enabled: false,
              discharge_enabled: false,
            },
          },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const response = (await sendDevdLocalUsbJsonlRequest(
      makeAgent(),
      "usb--dev-cu-usbmodem21221401",
      {
        id: 1,
        method: "power.runtime_set",
        params: { action: "output", enabled: false, owner: 7 },
      },
    )) as { ok: boolean; result?: { runtime?: { output_enabled?: boolean } } };

    expect(response.ok).toBe(true);
    expect(response.result?.runtime?.output_enabled).toBe(false);
  });
});

describe("flashBundledWithLocalUsb", () => {
  test("posts bundled catalog and selected asset to the new flash endpoint", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/firmware/releases/v0.5.1/isolapurr-usb-hub.app.bin")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (
        url.endsWith(
          "/firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
        )
      ) {
        return jsonResponse({
          schemaVersion: "1",
          artifacts: [
            {
              artifactId: "isolapurr-demo-051",
              target: "esp32s3_app",
              version: "v0.5.1",
              files: [
                {
                  kind: "app_bin",
                  path: "isolapurr-usb-hub.app.bin",
                  sha256: "abc",
                  size: 3,
                  flashAddress: 0x10000,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/serial/register")) {
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (url.endsWith("/api/v1/serial/lease")) {
        return jsonResponse({ lease_id: "lease-1" });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/flash-bundled",
        )
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.artifactId).toBe("isolapurr-demo-051");
        expect(body.fileKind).toBe("app_bin");
        expect(body.firstTime).toBe(false);
        expect(body.leaseId).toBe("lease-1");
        expect((body.catalog as { schemaVersion?: string }).schemaVersion).toBe(
          "1",
        );
        return jsonResponse({ ok: true, log: "done" });
      }
      if (url.endsWith("/api/v1/serial/lease/lease-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const release = DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0];
    if (!release) {
      throw new Error("missing demo release");
    }
    const log = await flashBundledWithLocalUsb(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      release,
      release.app,
      false,
      { deviceId: "aabbcc001122" },
    );

    expect(log).toBe("done");
  });

  test("sends full-image recovery assets for first-time Local USB flash", async () => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (
        url.endsWith("/firmware/releases/v0.5.1/isolapurr-usb-hub.full.bin")
      ) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      if (
        url.endsWith(
          "/firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
        )
      ) {
        return jsonResponse({
          schemaVersion: "1",
          artifacts: [
            {
              artifactId: "isolapurr-demo-051-recovery",
              target: "esp32s3_full",
              version: "v0.5.1",
              files: [
                {
                  kind: "full_image",
                  path: "isolapurr-usb-hub.full.bin",
                  sha256: "abc",
                  size: 3,
                  flashAddress: 0,
                },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/serial/register")) {
        return jsonResponse({
          ok: true,
          device: {
            id: "usb--dev-cu-usbmodem21221401",
            usb: { portPath: "/dev/cu.usbmodem21221401" },
          },
        });
      }
      if (url.endsWith("/api/v1/serial/lease")) {
        return jsonResponse({ lease_id: "lease-1" });
      }
      if (
        url.endsWith(
          "/api/v1/devices/usb--dev-cu-usbmodem21221401/flash-bundled",
        )
      ) {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        expect(body.fileKind).toBe("full_image");
        expect(body.firstTime).toBe(true);
        expect(body.confirmNonProjectFirmware).toBe(true);
        expect(body.expectedIdentity).toEqual({
          deviceId: "aabbcc001122",
          mac: "AA:BB:CC:DD:EE:FF",
        });
        return jsonResponse({ ok: true, log: "done" });
      }
      if (url.endsWith("/api/v1/serial/lease/lease-1")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const release = DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0];
    if (!release?.recovery) {
      throw new Error("missing demo recovery release");
    }
    const log = await flashBundledWithLocalUsb(
      makeAgent(),
      "/dev/cu.usbmodem21221401",
      release,
      release.recovery,
      true,
      { deviceId: "aabbcc001122", mac: "AA:BB:CC:DD:EE:FF" },
      true,
    );

    expect(log).toBe("done");
  });
});
