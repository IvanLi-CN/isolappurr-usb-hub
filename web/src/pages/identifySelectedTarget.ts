import type { MutableRefObject } from "react";
import { tryBootstrapDesktopAgent } from "../domain/desktopAgent";
import type { IdentifyResponse, Result } from "../domain/deviceApi";
import {
  nextJsonlRequestId,
  type SerialLikePort,
  sendLocalUsbJsonlRequest,
  WebSerialJsonlTransport,
} from "../domain/hardwareConsole";

export async function identifySelectedTarget({
  demoEnabled,
  transportMode,
  selectedLocalUsbPort,
  selectedWebSerialPortRef,
}: {
  demoEnabled: boolean;
  transportMode: "local_usb" | "web_serial" | null;
  selectedLocalUsbPort: string;
  selectedWebSerialPortRef: MutableRefObject<SerialLikePort | null>;
}): Promise<Result<IdentifyResponse>> {
  if (demoEnabled) {
    return { ok: true, value: { accepted: true, duration_ms: 5000 } };
  }
  const request = {
    id: nextJsonlRequestId(),
    method: "identify",
    timeoutMs: 6_000,
  };
  let response: unknown;
  if (transportMode === "local_usb") {
    const agent = await tryBootstrapDesktopAgent();
    if (!agent) throw new Error("Local USB service is not running.");
    if (!selectedLocalUsbPort)
      throw new Error("Select a Local USB device before locating it.");
    response = await sendLocalUsbJsonlRequest(
      agent,
      selectedLocalUsbPort,
      request,
    );
  } else if (transportMode === "web_serial") {
    const port = selectedWebSerialPortRef.current;
    if (!port)
      throw new Error("Open Web USB first and choose the target device.");
    const transport = new WebSerialJsonlTransport();
    let returnedPort = false;
    try {
      await transport.connectToPort(port);
      response = await transport.request(request);
      selectedWebSerialPortRef.current =
        await transport.takePortForExclusiveUse();
      returnedPort = true;
    } finally {
      if (!returnedPort) await transport.disconnect().catch(() => undefined);
    }
  } else {
    throw new Error("Choose USB device or Web USB before locating it.");
  }
  const envelope =
    response && typeof response === "object"
      ? (response as { result?: unknown; error?: unknown })
      : null;
  const value = envelope?.result ?? response;
  if (
    value &&
    typeof value === "object" &&
    (value as { accepted?: unknown }).accepted === true &&
    (value as { duration_ms?: unknown }).duration_ms === 5000
  ) {
    return { ok: true, value: { accepted: true, duration_ms: 5000 } };
  }
  const error =
    envelope?.error && typeof envelope.error === "object"
      ? (envelope.error as {
          code?: unknown;
          message?: unknown;
          retryable?: unknown;
          status?: unknown;
        })
      : null;
  return {
    ok: false,
    error: {
      kind: "api_error",
      status: typeof error?.status === "number" ? error.status : 409,
      code: typeof error?.code === "string" ? error.code : "identify_failed",
      message:
        typeof error?.message === "string"
          ? error.message
          : "Device locate request was not accepted.",
      retryable: error?.retryable === true,
    },
  };
}
