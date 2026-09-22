import type { DeviceApiError, Result } from "../domain/deviceApi";
import { nextJsonlRequestId } from "../domain/hardwareConsole";
import {
  forgetWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
} from "../domain/webSerialLinks";
import {
  type JsonlEnvelope,
  jsonlTimeoutMsForMethod,
  recoverWifiClearLikeTimeout,
  shouldForgetWebSerialTransport,
} from "./device-runtime-support";

export function createWebSerialRequester({
  getDispatchAuthorizationError,
}: {
  getDispatchAuthorizationError: (method: string) => DeviceApiError | null;
}) {
  return async <T>(
    deviceId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Result<T>> => {
    const transport = getWebSerialDeviceTransport(deviceId);
    if (!transport) {
      return {
        ok: false,
        error: { kind: "offline", message: "Web Serial not connected" },
      };
    }
    let authorizationError: DeviceApiError | null = null;
    try {
      const response = await transport.request(
        {
          id: nextJsonlRequestId(),
          method,
          params,
          timeoutMs: jsonlTimeoutMsForMethod(method, params),
        },
        {
          beforeDispatch: () => {
            authorizationError = getDispatchAuthorizationError(method);
            return authorizationError === null;
          },
        },
      );
      const envelope = response as JsonlEnvelope<T>;
      if (envelope?.ok && envelope.result !== undefined) {
        return { ok: true, value: envelope.result };
      }
      return {
        ok: false,
        error: {
          kind: "api_error",
          status: 500,
          code: envelope?.error?.code ?? "web_serial_error",
          message: envelope?.error?.message ?? "Web Serial request failed",
          retryable: envelope?.error?.retryable ?? false,
        },
      };
    } catch (err) {
      if (authorizationError) {
        return { ok: false, error: authorizationError };
      }
      const recovered = await recoverWifiClearLikeTimeout<T>(
        async (request) => transport.request(request),
        method,
        params,
      );
      if (recovered) {
        return recovered;
      }
      if (shouldForgetWebSerialTransport(err)) {
        forgetWebSerialDeviceTransport(deviceId);
      }
      return {
        ok: false,
        error: {
          kind: "offline",
          message:
            err instanceof Error ? err.message : "Web Serial request failed",
        },
      };
    }
  };
}
