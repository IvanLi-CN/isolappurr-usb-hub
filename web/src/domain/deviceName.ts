import type { DeviceInfoResponse } from "./deviceApi";
import type { StoredDevice } from "./devices";

export type DeviceNameCache =
  | { state: "unknown"; value?: undefined }
  | { state: "unset"; value?: undefined }
  | { state: "value"; value: string };

export const UNKNOWN_DEVICE_NAME_CACHE: DeviceNameCache = { state: "unknown" };

export function parseDeviceNameCache(value: unknown): DeviceNameCache {
  if (!value || typeof value !== "object") {
    return UNKNOWN_DEVICE_NAME_CACHE;
  }
  const record = value as Record<string, unknown>;
  if (record.state === "unset") {
    return { state: "unset" };
  }
  if (record.state !== "value" || typeof record.value !== "string") {
    return UNKNOWN_DEVICE_NAME_CACHE;
  }
  const name = record.value;
  if (
    name.length === 0 ||
    new TextEncoder().encode(name).length > 48 ||
    [...name].some((char) => /\p{Cc}/u.test(char)) ||
    /^\s|\s$/u.test(name)
  ) {
    return UNKNOWN_DEVICE_NAME_CACHE;
  }
  return { state: "value", value: name };
}

export function normalizeDeviceDisplayName(value: string): string {
  return value.trim();
}

export function validateDeviceDisplayName(value: string): string | null {
  const normalized = normalizeDeviceDisplayName(value);
  const bytes = new TextEncoder().encode(normalized).length;
  if (bytes < 1 || bytes > 48) {
    return "Device name must be 1-48 UTF-8 bytes.";
  }
  if ([...normalized].some((char) => /\p{Cc}/u.test(char))) {
    return "Device name must not contain control characters.";
  }
  return null;
}

export function deviceNameBytes(value: string): number {
  return new TextEncoder().encode(normalizeDeviceDisplayName(value)).length;
}

export function resolveDeviceDisplayName(params: {
  profileName: string;
  hostname?: string | null;
  hardware: DeviceNameCache;
}): string {
  if (params.hardware.state === "value") {
    return params.hardware.value;
  }
  if (params.hardware.state === "unset" && params.hostname?.trim()) {
    return params.hostname;
  }
  return params.profileName;
}

export function deviceNameCacheFromInfo(
  info: DeviceInfoResponse,
): DeviceNameCache {
  if (!Object.hasOwn(info.device, "display_name")) {
    return UNKNOWN_DEVICE_NAME_CACHE;
  }
  return typeof info.device.display_name === "string"
    ? { state: "value", value: info.device.display_name }
    : { state: "unset" };
}

export function resolveStoredDeviceDisplayName(
  device: Pick<StoredDevice, "id" | "name" | "hostname" | "deviceNameCache">,
  info?: DeviceInfoResponse | null,
): string {
  const hardware = info
    ? deviceNameCacheFromInfo(info)
    : (device.deviceNameCache ?? UNKNOWN_DEVICE_NAME_CACHE);
  return resolveDeviceDisplayName({
    profileName: device.name,
    hostname:
      info?.device.hostname ??
      device.hostname ??
      (device.deviceNameCache?.state === "unset"
        ? `isolapurr-usb-hub-${device.id}`
        : undefined),
    hardware,
  });
}
