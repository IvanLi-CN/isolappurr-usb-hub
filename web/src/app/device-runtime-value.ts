import type { StoredDevice } from "../domain/devices";
import { getLocalUsbDeviceLink } from "../domain/localUsbLinks";
import type { PortId } from "../domain/ports";
import { getWebSerialDeviceTransport } from "../domain/webSerialLinks";
import {
  type ConnectionState,
  type DeviceRuntime,
  type DeviceRuntimeContextValue,
  type DeviceTransport,
  localUsbDeviceIdForDevice,
  shortApiError,
} from "./device-runtime-support";

type DeviceRuntimeValueParams = {
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
  devices: StoredDevice[];
  localUsbPortByDevice: Record<string, string>;
} & Pick<
  DeviceRuntimeContextValue,
  | "refreshDevice"
  | "deviceInfo"
  | "wifiConfig"
  | "saveWifiConfig"
  | "clearWifiConfig"
  | "resetSettings"
  | "rebootDevice"
  | "pdDiagnostics"
  | "powerConfig"
  | "savePowerConfig"
  | "restorePowerDefaults"
  | "setPowerLock"
  | "setPower"
  | "replug"
  | "setUsbCDownstreamRoute"
>;

const OFFLINE_THRESHOLD_MS = 10_000;

export function buildDeviceRuntimeContextValue({
  now,
  runtimeById,
  devices,
  localUsbPortByDevice,
  refreshDevice,
  deviceInfo,
  wifiConfig,
  saveWifiConfig,
  clearWifiConfig,
  resetSettings,
  rebootDevice,
  pdDiagnostics,
  powerConfig,
  savePowerConfig,
  restorePowerDefaults,
  setPowerLock,
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
    const active = runtimeById[deviceId]?.transport ?? null;
    const stored = devices.find((device) => device.id === deviceId);
    if (active === "web_serial" || active === "local_usb") {
      return active;
    }
    if (getWebSerialDeviceTransport(deviceId)) {
      return "web_serial";
    }
    if (
      localUsbPortByDevice[deviceId] ||
      getLocalUsbDeviceLink(deviceId) ||
      (stored ? localUsbDeviceIdForDevice(stored) : null)
    ) {
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
    connectionState,
    lastOkAt,
    lastErrorLabel,
    transport,
    wifiManagementTransport,
    channelState,
    hub,
    port,
    pending,
    refreshDevice,
    deviceInfo,
    wifiConfig,
    saveWifiConfig,
    clearWifiConfig,
    resetSettings,
    rebootDevice,
    pdDiagnostics,
    powerConfig,
    savePowerConfig,
    restorePowerDefaults,
    setPowerLock,
    setPower,
    replug,
    setUsbCDownstreamRoute,
  };
}
