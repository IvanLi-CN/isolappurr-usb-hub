import { describe, expect, test } from "bun:test";

import { LocalUsbAgentHttpError } from "../domain/hardwareConsole";
import {
  jsonlTimeoutMsForMethod,
  localUsbErrorToDeviceApiError,
  orderedDeviceTransports,
  resolveActiveDeviceTransport,
  resolveTransportBadgeState,
  runQueuedDeviceRequest,
  shortApiError,
  shouldForgetWebSerialTransport,
  shouldResetLocalUsbConnectionCache,
} from "./device-runtime-support";

describe("localUsbErrorToDeviceApiError", () => {
  test("preserves structured devd busy errors", () => {
    const error = localUsbErrorToDeviceApiError(
      new LocalUsbAgentHttpError("device busy", 409, "busy", true),
    );

    expect(error).toEqual({
      kind: "busy",
      message: "device busy",
      retryable: true,
    });
  });

  test("preserves structured devd API errors instead of marking offline", () => {
    const error = localUsbErrorToDeviceApiError(
      new LocalUsbAgentHttpError(
        "connected device firmware version `0.0.1` is incompatible",
        400,
        "bad_request",
        false,
      ),
    );

    expect(error).toEqual({
      kind: "api_error",
      status: 400,
      code: "bad_request",
      message: "connected device firmware version `0.0.1` is incompatible",
      retryable: false,
    });
  });
});

describe("shouldResetLocalUsbConnectionCache", () => {
  test("keeps cached agent and device links for structured devd errors", () => {
    expect(
      shouldResetLocalUsbConnectionCache(
        new LocalUsbAgentHttpError("device busy", 409, "busy", true),
      ),
    ).toBe(false);
  });

  test("resets cache for transport-level failures", () => {
    expect(shouldResetLocalUsbConnectionCache(new Error("fetch failed"))).toBe(
      true,
    );
  });
});

describe("orderedDeviceTransports", () => {
  test("drops stale web serial preference after the browser transport is gone", () => {
    expect(
      orderedDeviceTransports({
        preferred: "web_serial",
        runtimeTransport: "local_usb",
        channelLastOkAt: {
          http: null,
          web_serial: Date.now(),
          local_usb: Date.now(),
        },
        httpLinked: true,
        localUsbLinked: true,
        webSerialLinked: false,
        preferLocalUsbFirst: true,
      }),
    ).toEqual(["local_usb", "http"]);
  });

  test("keeps an active web serial transport first while it is still linked", () => {
    expect(
      orderedDeviceTransports({
        preferred: "web_serial",
        runtimeTransport: "http",
        channelLastOkAt: {
          http: Date.now(),
          web_serial: Date.now(),
          local_usb: Date.now(),
        },
        httpLinked: true,
        localUsbLinked: true,
        webSerialLinked: true,
        preferLocalUsbFirst: false,
      }),
    ).toEqual(["web_serial", "http", "local_usb"]);
  });
});

describe("shouldForgetWebSerialTransport", () => {
  test("keeps the browser transport after a transient JSONL timeout", () => {
    expect(
      shouldForgetWebSerialTransport(
        new Error(
          "No IsolaPurr JSONL response received from this serial device.",
        ),
      ),
    ).toBe(false);
  });

  test("forgets the browser transport after a hard disconnect", () => {
    expect(
      shouldForgetWebSerialTransport(
        new Error("Web Serial transport disconnected"),
      ),
    ).toBe(true);
    expect(
      shouldForgetWebSerialTransport(
        new Error("Serial stream closed before a JSONL response"),
      ),
    ).toBe(true);
  });
});

describe("resolveActiveDeviceTransport", () => {
  const devices = [
    {
      id: "856a141cdbd4",
      name: "isolapurr-usb-hub-856a141cdbd4",
      baseUrl: "http://isolapurr-usb-hub-856a141cdbd4.local",
      transports: {
        httpBaseUrl: "http://isolapurr-usb-hub-856a141cdbd4.local",
      },
    },
  ];

  test("keeps web serial active while the live link still exists", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices,
        runtime: {
          lastOkAt: Date.now(),
          lastError: null,
          transport: "web_serial",
          channels: {
            http: { lastOkAt: Date.now(), lastError: null },
            web_serial: { lastOkAt: Date.now(), lastError: null },
            local_usb: { lastOkAt: null, lastError: null },
          },
          hub: null,
          ports: null,
          pending: { port_a: false, port_c: false },
        },
        preferred: "web_serial",
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: true,
      }),
    ).toBe("web_serial");
  });

  test("drops stale web serial and falls back to LAN when the link is gone", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices,
        runtime: {
          lastOkAt: Date.now(),
          lastError: {
            kind: "offline",
            message: "Web Serial transport disconnected",
          },
          transport: "web_serial",
          channels: {
            http: { lastOkAt: Date.now(), lastError: null },
            web_serial: {
              lastOkAt: Date.now(),
              lastError: {
                kind: "offline",
                message: "Web Serial transport disconnected",
              },
            },
            local_usb: { lastOkAt: null, lastError: null },
          },
          hub: null,
          ports: null,
          pending: { port_a: false, port_c: false },
        },
        preferred: "web_serial",
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: false,
      }),
    ).toBe("http");
  });
});

describe("resolveTransportBadgeState", () => {
  test("shows a linked online serial channel as connected", () => {
    expect(
      resolveTransportBadgeState({
        candidate: "web_serial",
        activeTransport: "http",
        channelOnline: true,
        linked: true,
        hasHistory: true,
      }),
    ).toBe("connected");
  });

  test("downgrades serial to history when only historical state remains", () => {
    expect(
      resolveTransportBadgeState({
        candidate: "web_serial",
        activeTransport: "http",
        channelOnline: false,
        linked: false,
        hasHistory: true,
      }),
    ).toBe("history");
  });

  test("keeps persisted serial history visible without a live link", () => {
    expect(
      resolveTransportBadgeState({
        candidate: "web_serial",
        activeTransport: "http",
        channelOnline: false,
        linked: false,
        hasHistory: true,
      }),
    ).toBe("history");
  });
});

describe("jsonlTimeoutMsForMethod", () => {
  test("uses the long idle-bias timeout for calibration runs", () => {
    expect(jsonlTimeoutMsForMethod("power.idle_bias_run")).toBe(178_000);
  });

  test("keeps wifi-clear-like requests on the shorter recovery timeout", () => {
    expect(jsonlTimeoutMsForMethod("wifi.clear")).toBe(8_000);
    expect(jsonlTimeoutMsForMethod("settings.reset", { scope: "wifi" })).toBe(
      8_000,
    );
  });

  test("leaves ordinary requests on the default transport timeout", () => {
    expect(jsonlTimeoutMsForMethod("power.config_get")).toBeUndefined();
  });
});

describe("runQueuedDeviceRequest", () => {
  test("serializes requests for the same device", async () => {
    const queues: Record<string, Promise<void>> = {};
    const events: string[] = [];
    let releaseFirst: (() => void) | null = null;
    let notifyFirstStarted: (() => void) | null = null;
    const firstStarted = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });

    const first = runQueuedDeviceRequest(queues, "f293cc9c139e", async () => {
      events.push("first:start");
      notifyFirstStarted?.();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      return "first";
    });

    const second = runQueuedDeviceRequest(queues, "f293cc9c139e", async () => {
      events.push("second:start");
      events.push("second:end");
      return "second";
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);

    releaseFirst?.();
    const results = await Promise.all([first, second]);
    expect(results).toEqual(["first", "second"]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  test("keeps different devices independent", async () => {
    const queues: Record<string, Promise<void>> = {};
    const events: string[] = [];

    await Promise.all([
      runQueuedDeviceRequest(queues, "f293cc9c139e", async () => {
        events.push("f293:start");
        await Promise.resolve();
        events.push("f293:end");
      }),
      runQueuedDeviceRequest(queues, "856a141cdbd4", async () => {
        events.push("856a:start");
        await Promise.resolve();
        events.push("856a:end");
      }),
    ]);

    expect(events).toContain("f293:start");
    expect(events).toContain("856a:start");
    expect(events).toContain("f293:end");
    expect(events).toContain("856a:end");
  });
});

describe("shortApiError", () => {
  test("maps browser-blocked and name-resolution failures to actionable labels", () => {
    expect(
      shortApiError({
        kind: "browser_blocked",
        actionable: "Browser blocked",
        message: "blocked",
      }),
    ).toBe("Browser blocked: private-network access");
    expect(
      shortApiError({
        kind: "name_resolution",
        actionable: "Name/Reachability",
        message: "not resolved",
      }),
    ).toBe("Name/Reachability: use verified IPv4");
  });
});
