import {
  clearIdleBiasCalibration,
  clearWifiConfig,
  getDeviceInfo,
  getIdleBias,
  getPdDiagnostics,
  getPorts,
  getPowerConfig,
  getWifiConfig,
  type PowerConfigInput,
  type Result,
  rebootDevice,
  replugPort,
  resetSettings as resetDeviceSettings,
  restorePowerDefaults,
  runIdleBiasCalibration,
  type SettingsResetScope,
  setIdleBiasCorrection,
  setPortPower,
  setPowerConfig,
  setPowerLock,
  setUsbCDownstreamRoute,
  setWifiConfig,
  type WifiConfigInput,
} from "../domain/deviceApi";
import type { PortId, UsbCDownstreamRoute } from "../domain/ports";

export async function requestHttpTransport<T>(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<Result<T>> {
  if (method === "ports.get") {
    return getPorts(baseUrl) as Promise<Result<T>>;
  }
  if (method === "info") {
    return getDeviceInfo(baseUrl) as Promise<Result<T>>;
  }
  if (method === "wifi.get") {
    return getWifiConfig(baseUrl) as Promise<Result<T>>;
  }
  if (method === "pd.diagnostics_get") {
    return getPdDiagnostics(baseUrl) as Promise<Result<T>>;
  }
  if (method === "power.config_get") {
    return getPowerConfig(baseUrl) as Promise<Result<T>>;
  }
  if (method === "power.idle_bias_get") {
    return getIdleBias(baseUrl) as Promise<Result<T>>;
  }
  if (method === "power.config_set") {
    return setPowerConfig(
      baseUrl,
      params?.config as PowerConfigInput,
      Number(params?.owner ?? 0),
    ) as Promise<Result<T>>;
  }
  if (method === "power.idle_bias_set") {
    return setIdleBiasCorrection(
      baseUrl,
      Boolean(params?.correction_enabled),
      Number(params?.owner ?? 0),
    ) as Promise<Result<T>>;
  }
  if (method === "power.config_defaults") {
    return restorePowerDefaults(baseUrl, Number(params?.owner ?? 0)) as Promise<
      Result<T>
    >;
  }
  if (method === "power.idle_bias_run") {
    return runIdleBiasCalibration(
      baseUrl,
      Number(params?.owner ?? 0),
    ) as Promise<Result<T>>;
  }
  if (method === "power.idle_bias_clear") {
    return clearIdleBiasCalibration(
      baseUrl,
      Number(params?.owner ?? 0),
    ) as Promise<Result<T>>;
  }
  if (method === "power.lock") {
    return setPowerLock(
      baseUrl,
      Number(params?.owner ?? 0),
      Boolean(params?.acquire ?? true),
    ) as Promise<Result<T>>;
  }
  if (method === "wifi.set") {
    return setWifiConfig(baseUrl, {
      ssid: String(params?.ssid ?? ""),
      psk: String(params?.psk ?? ""),
    } satisfies WifiConfigInput) as Promise<Result<T>>;
  }
  if (method === "wifi.clear") {
    return clearWifiConfig(baseUrl) as Promise<Result<T>>;
  }
  if (method === "settings.reset") {
    return resetDeviceSettings(
      baseUrl,
      params?.scope as SettingsResetScope,
      params?.owner === undefined ? undefined : Number(params.owner),
    ) as Promise<Result<T>>;
  }
  if (method === "reboot") {
    return rebootDevice(baseUrl) as Promise<Result<T>>;
  }
  if (method === "port.power_set") {
    return setPortPower(
      baseUrl,
      params?.port as PortId,
      Boolean(params?.enabled),
    ) as Promise<Result<T>>;
  }
  if (method === "port.replug") {
    return replugPort(baseUrl, params?.port as PortId) as Promise<Result<T>>;
  }
  if (method === "hub.route_set") {
    return setUsbCDownstreamRoute(
      baseUrl,
      params?.route as UsbCDownstreamRoute,
    ) as Promise<Result<T>>;
  }
  return {
    ok: false,
    error: {
      kind: "api_error",
      status: 400,
      code: "unsupported_http_method",
      message: `Unsupported HTTP device method: ${method}`,
      retryable: false,
    },
  };
}
