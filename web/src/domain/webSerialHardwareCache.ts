import type { HardwareBoardInfo } from "./hardwareConsole";

const STORAGE_KEY = "isolapurr.web-serial-hardware.v1";

type HardwareCache = Record<string, HardwareBoardInfo>;

function normalizeMac(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase().replace(/[^0-9a-f]/g, "");
  return normalized.length === 12 ? normalized : null;
}

function readCache(): HardwareCache {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as HardwareCache)
      : {};
  } catch {
    return {};
  }
}

export function readCachedWebSerialHardware(
  firmwareMac: string | undefined,
): HardwareBoardInfo | undefined {
  const key = normalizeMac(firmwareMac);
  if (!key) {
    return undefined;
  }
  const hardware = readCache()[key];
  return hardware?.source === "esptool-js" &&
    normalizeMac(hardware.macAddress) === key
    ? hardware
    : undefined;
}

export function cacheWebSerialHardware(
  firmwareMac: string | undefined,
  hardware: HardwareBoardInfo,
): boolean {
  const firmwareKey = normalizeMac(firmwareMac);
  const hardwareKey = normalizeMac(hardware.macAddress);
  if (
    !firmwareKey ||
    firmwareKey !== hardwareKey ||
    hardware.source !== "esptool-js"
  ) {
    return false;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readCache(), [firmwareKey]: hardware }),
    );
    return true;
  } catch {
    return false;
  }
}
