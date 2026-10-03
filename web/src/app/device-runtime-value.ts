import { resolveStoredDeviceDisplayName } from "../domain/deviceName";
import type { StoredDevice } from "../domain/devices";
import type { PortId } from "../domain/ports";
import {
  type ConnectionPresentation,
  type ConnectionState,
  type DeviceRuntime,
  type DeviceRuntimeContextValue,
  type DeviceTransport,
  shortApiError,
} from "./device-runtime-support";

type DeviceRuntimeValueParams = {
  now: number;
  devices: StoredDevice[];
  runtimeById: Record<string, DeviceRuntime>;
} & Pick<
  DeviceRuntimeContextValue,
  | "coordination"
  | "canControlHardware"
  | "powerLockOwner"
  | "requestControlTakeover"
  | "refreshDevice"
  | "deviceInfo"
  | "identify"
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
  | "setData"
  | "replug"
  | "setUsbCDownstreamRoute"
  | "setDeviceName"
  | "clearDeviceName"
>;

const OFFLINE_THRESHOLD_MS = 10_000;

function transportLabel(transport: DeviceTransport): string {
  if (transport === "http") {
    return "Wi-Fi / LAN";
  }
  return transport === "local_usb" ? "Local USB" : "Web Serial";
}

export function resolveConnectionPresentation(
  state: ConnectionState,
  runtime: DeviceRuntime | null | undefined,
): ConnectionPresentation {
  if (state !== "online" || !runtime?.transport) {
    return { connectionLabel: "Not connected", endpointLabel: "Unavailable" };
  }

  if (!runtime.identityVerified) {
    return {
      connectionLabel: transportLabel(runtime.transport),
      endpointLabel: "Unavailable",
    };
  }

  const endpoint = runtime.activeEndpoint;
  if (!endpoint || endpoint.kind !== runtime.transport) {
    return {
      connectionLabel: transportLabel(runtime.transport),
      endpointLabel: "Unavailable",
    };
  }

  if (endpoint.kind === "http") {
    return {
      connectionLabel: transportLabel(runtime.transport),
      endpointLabel: endpoint.url.trim() || "Unavailable",
    };
  }
  if (endpoint.kind === "local_usb") {
    return {
      connectionLabel: transportLabel(runtime.transport),
      endpointLabel: endpoint.portPath.trim() || "Unavailable",
    };
  }

  const vendorId = endpoint.usbVendorId;
  const productId = endpoint.usbProductId;
  const details = [
    vendorId === undefined
      ? null
      : `VID 0x${vendorId.toString(16).padStart(4, "0").toUpperCase()}`,
    productId === undefined
      ? null
      : `PID 0x${productId.toString(16).padStart(4, "0").toUpperCase()}`,
  ].filter((value): value is string => value !== null);
  return {
    connectionLabel: transportLabel(runtime.transport),
    endpointLabel:
      details.length > 0
        ? `Browser-authorized serial port (${details.join(", ")})`
        : "Browser-authorized serial port (details unavailable)",
  };
}

export function buildDeviceRuntimeContextValue({
  now,
  devices,
  runtimeById,
  coordination,
  canControlHardware,
  powerLockOwner,
  requestControlTakeover,
  refreshDevice,
  deviceInfo,
  identify,
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
  setData,
  replug,
  setUsbCDownstreamRoute,
  setDeviceName,
  clearDeviceName,
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

  const connectionPresentation = (deviceId: string) =>
    resolveConnectionPresentation(
      connectionState(deviceId),
      runtimeById[deviceId],
    );

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

  const displayNameInfo = (deviceId: string) => {
    const runtime = runtimeById[deviceId];
    return runtime?.identityVerified ? (runtime.deviceInfo ?? null) : null;
  };
  const displayName = (deviceId: string) => {
    const device = devices.find((candidate) => candidate.id === deviceId);
    return device
      ? resolveStoredDeviceDisplayName(device, displayNameInfo(deviceId))
      : deviceId;
  };

  return {
    now,
    runtimeById,
    coordination,
    canControlHardware,
    connectionState,
    lastOkAt,
    lastErrorLabel,
    transport,
    connectionPresentation,
    wifiManagementTransport,
    channelState,
    hub,
    port,
    pending,
    displayName,
    displayNameInfo,
    powerLockOwner,
    requestControlTakeover,
    refreshDevice,
    deviceInfo,
    identify,
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
    setData,
    replug,
    setUsbCDownstreamRoute,
    setDeviceName,
    clearDeviceName,
  };
}
