import type { Dispatch, SetStateAction } from "react";
import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  Result,
} from "../domain/deviceApi";
import type { DeviceRuntime, DeviceTransport } from "./device-runtime-support";

type RuntimeStateSetter = Dispatch<
  SetStateAction<Record<string, DeviceRuntime>>
>;

export function markDeviceRuntimeChannel(
  setRuntimeById: RuntimeStateSetter,
  deviceId: string,
  transport: DeviceTransport,
  result: Result<unknown>,
): void {
  setRuntimeById((prev) => {
    const current = prev[deviceId];
    if (!current) {
      return prev;
    }
    return {
      ...prev,
      [deviceId]: {
        ...current,
        channels: {
          ...current.channels,
          [transport]: {
            lastOkAt: result.ok
              ? Date.now()
              : current.channels[transport].lastOkAt,
            lastError: result.ok ? null : result.error,
          },
        },
      },
    };
  });
}

export function syncDeviceRuntimePowerConfig(
  setRuntimeById: RuntimeStateSetter,
  deviceId: string,
  nextConfig: PowerConfigResponse,
): void {
  setRuntimeById((prev) => {
    const current = prev[deviceId];
    return current
      ? { ...prev, [deviceId]: { ...current, powerConfig: nextConfig } }
      : prev;
  });
}

export function syncDeviceRuntimeIdleBias(
  setRuntimeById: RuntimeStateSetter,
  deviceId: string,
  nextIdleBias: IdleBiasResponse,
): void {
  setRuntimeById((prev) => {
    const current = prev[deviceId];
    return current
      ? { ...prev, [deviceId]: { ...current, idleBias: nextIdleBias } }
      : prev;
  });
}

export function syncDeviceRuntimePdDiagnostics(
  setRuntimeById: RuntimeStateSetter,
  deviceId: string,
  nextPdDiagnostics: PdDiagnosticsResponse,
): void {
  setRuntimeById((prev) => {
    const current = prev[deviceId];
    return current
      ? {
          ...prev,
          [deviceId]: { ...current, pdDiagnostics: nextPdDiagnostics },
        }
      : prev;
  });
}
