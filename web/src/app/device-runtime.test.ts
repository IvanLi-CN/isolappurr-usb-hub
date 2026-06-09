import { describe, expect, test } from "bun:test";

import { LocalUsbAgentHttpError } from "../domain/hardwareConsole";
import {
  localUsbErrorToDeviceApiError,
  orderedDeviceTransports,
  shouldResetLocalUsbConnectionCache,
} from "./device-runtime";

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
