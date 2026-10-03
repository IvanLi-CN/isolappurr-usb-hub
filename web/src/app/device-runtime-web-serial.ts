import type { DeviceApiError, Result } from "../domain/deviceApi";
import { nextJsonlRequestId } from "../domain/hardwareConsole";
import {
  forgetWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
} from "../domain/webSerialLinks";
import {
  type ActiveConnectionEndpoint,
  type JsonlEnvelope,
  jsonlTimeoutMsForMethod,
  recoverWifiClearLikeTimeout,
  shouldForgetWebSerialTransport,
} from "./device-runtime-support";

export type WebSerialDispatchResult<T> = {
  result: Result<T>;
  binding: object | null;
  endpoint: ActiveConnectionEndpoint | null;
};

export function createWebSerialEndpointRequester({
  getDispatchAuthorizationError,
}: {
  getDispatchAuthorizationError: (method: string) => DeviceApiError | null;
}) {
  return async <T>(
    deviceId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<WebSerialDispatchResult<T>> => {
    const transport = getWebSerialDeviceTransport(deviceId);
    if (!transport) {
      return {
        result: {
          ok: false,
          error: { kind: "offline", message: "Web Serial not connected" },
        },
        binding: null,
        endpoint: null,
      };
    }
    const withEndpoint = (result: Result<T>): WebSerialDispatchResult<T> => {
      const info = result.ok ? transport.getActivePortUsbInfo() : null;
      return {
        result,
        binding: transport,
        endpoint: info ? { kind: "web_serial", ...info } : null,
      };
    };
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
        return withEndpoint({ ok: true, value: envelope.result });
      }
      return withEndpoint({
        ok: false,
        error: {
          kind: "api_error",
          status: 500,
          code: envelope?.error?.code ?? "web_serial_error",
          message: envelope?.error?.message ?? "Web Serial request failed",
          retryable: envelope?.error?.retryable ?? false,
        },
      });
    } catch (err) {
      if (authorizationError) {
        return withEndpoint({ ok: false, error: authorizationError });
      }
      const recovered = await recoverWifiClearLikeTimeout<T>(
        async (request) => transport.request(request),
        method,
        params,
      );
      if (recovered) {
        return withEndpoint(recovered);
      }
      if (shouldForgetWebSerialTransport(err)) {
        forgetWebSerialDeviceTransport(deviceId);
      }
      return withEndpoint({
        ok: false,
        error: {
          kind: "offline",
          message:
            err instanceof Error ? err.message : "Web Serial request failed",
        },
      });
    }
  };
}
