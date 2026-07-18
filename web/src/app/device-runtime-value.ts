import type { PortId } from "../domain/ports";
import {
  type ConnectionState,
  type DeviceRuntime,
  type DeviceRuntimeContextValue,
  type DeviceTransport,
  shortApiError,
} from "./device-runtime-support";

type DeviceRuntimeValueParams = {
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
} & Pick<
  DeviceRuntimeContextValue,
  | "coordination"
  | "canControlHardware"
  | "powerLockOwner"
  | "requestControlTakeover"
  | "refreshDevice"
  | "deviceInfo"
  | "wifiConfig"
  | "saveWifiConfig"
  | "clearWifiConfig"
  | "resetSettings"
  | "rebootDevice"
  | "pdDiagnostics"
  | "powerConfig"
  | "idleBias"
  | "savePowerConfig"
  | "restorePowerDefaults"
  | "setPowerLock"
  | "setPowerRuntime"
  | "setIdleBiasCorrection"
  | "runIdleBiasCalibration"
  | "clearIdleBiasCalibration"
  | "setPower"
  | "replug"
  | "setUsbCDownstreamRoute"
>;

const OFFLINE_THRESHOLD_MS = 10_000;

export function buildDeviceRuntimeContextValue({
  now,
  runtimeById,
  coordination,
  canControlHardware,
  powerLockOwner,
  requestControlTakeover,
  refreshDevice,
  deviceInfo,
  wifiConfig,
  saveWifiConfig,
  clearWifiConfig,
  resetSettings,
  rebootDevice,
  pdDiagnostics,
  powerConfig,
  idleBias,
  savePowerConfig,
  restorePowerDefaults,
  setPowerLock,
  setPowerRuntime,
  setIdleBiasCorrection,
  runIdleBiasCalibration,
  clearIdleBiasCalibration,
  setPower,
  replug,
  setUsbCDownstreamRoute,
}: DeviceRuntimeValueParams): DeviceRuntimeContextValue {
  const connectionState = (deviceId: string): ConnectionState => {
    const runtime = runtimeById[deviceId];
    if (!runtime || runtime.lastOkAt === null) {
      return "unknown";
    }
    return now - runtime.lastOkAt >= OFFLINE_THRESHOLD_MS
      ? "offline"
      : "online";
  };

  const lastOkAt = (deviceId: string): number | null =>
    runtimeById[deviceId]?.lastOkAt ?? null;

  const lastErrorLabel = (deviceId: string): string | null => {
    const runtime = runtimeById[deviceId];
    if (!runtime?.lastError) {
      return null;
    }
    return shortApiError(runtime.lastError);
  };

  const transport = (deviceId: string): DeviceTransport | null =>
    runtimeById[deviceId]?.transport ?? null;

  const wifiManagementTransport = (
    deviceId: string,
  ): DeviceTransport | null => {
    const active = transport(deviceId);
    if (active === "web_serial" || active === "local_usb") {
      return active;
    }
    const runtime = runtimeById[deviceId];
    if (runtime?.channels.web_serial.lastOkAt) {
      return "web_serial";
    }
    if (runtime?.channels.local_usb.lastOkAt) {
      return "local_usb";
    }
    return null;
  };

  const channelState = (
    deviceId: string,
    channelTransport: DeviceTransport,
  ): ConnectionState => {
    const channel = runtimeById[deviceId]?.channels[channelTransport];
    if (!channel?.lastOkAt) {
      return "unknown";
    }
    return now - channel.lastOkAt >= OFFLINE_THRESHOLD_MS
      ? "offline"
      : "online";
  };

  const hub = (deviceId: string) => runtimeById[deviceId]?.hub ?? null;

  const port = (deviceId: string, portId: PortId) =>
    runtimeById[deviceId]?.ports?.[portId] ?? null;

  const pending = (deviceId: string, portId: PortId): boolean =>
    runtimeById[deviceId]?.pending?.[portId] ?? false;

  return {
    now,
    runtimeById,
    coordination,
    canControlHardware,
    connectionState,
    lastOkAt,
    lastErrorLabel,
    transport,
    wifiManagementTransport,
    channelState,
    hub,
    port,
    pending,
    powerLockOwner,
    requestControlTakeover,
    refreshDevice,
    deviceInfo,
    wifiConfig,
    saveWifiConfig,
    clearWifiConfig,
    resetSettings,
    rebootDevice,
    pdDiagnostics,
    powerConfig,
    idleBias,
    savePowerConfig,
    restorePowerDefaults,
    setPowerLock,
    setPowerRuntime,
    setIdleBiasCorrection,
    runIdleBiasCalibration,
    clearIdleBiasCalibration,
    setPower,
    replug,
    setUsbCDownstreamRoute,
  };
}
