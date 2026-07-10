export type FlashTransportMode = "local_usb" | "web_serial";
export type FirmwareSourceMode = "releases" | "local_file";
export type FlashMode = "normal" | "recovery";
export type FlashModeReason = "normal" | "manual_recovery" | "forced_recovery";
export type ProbeKind =
  | "idle"
  | "probing"
  | "recognized"
  | "non_project"
  | "unknown";
export type WebSerialProbeMode = "picker" | "selected";
export type PendingConnectionAction =
  | "local_usb_picker"
  | "local_usb_probe"
  | "web_usb_picker"
  | "web_usb_reconnect"
  | "web_usb_release"
  | null;
export type ProbeActivityStage = "picker" | "probing" | "refreshing";
export type FlashActivityStatus = "idle" | "working" | "success" | "error";

export type ProbeState = {
  kind: ProbeKind;
  summary: string;
  detail: string;
  deviceId?: string;
  mac?: string;
  firmwareName?: string;
  firmwareVersion?: string;
  hostname?: string;
  fqdn?: string;
  variant?: string;
  wifiIpv4?: string;
  customHardwareName?: string;
  hardware?: HardwareBoardInfo;
};

export type WebSerialSelectionState = {
  summary: string;
  detail: string;
};

export type WebSerialProbeOptions = {
  refreshHardware: boolean;
  fallbackHardware?: HardwareBoardInfo;
  onPortReady?: () => void;
};

export type WebSerialInfoResult = {
  ok: boolean;
  port: SerialLikePort;
  value?: unknown;
  error?: string;
};

export type ProbeActivity = {
  stage: ProbeActivityStage;
  title: string;
  detail: string;
  deadlineAt: number;
};

export type FlashActivity = {
  status: FlashActivityStatus;
  title: string;
  detail: string;
  progressPercent?: number | null;
  indeterminate?: boolean;
};

export const DEMO_AUTHORIZED_WEB_USB_SELECTION: WebSerialSelectionState = {
  summary: "ESP32-S3 USB JTAG/serial",
  detail: "VID 303A · PID 1001 · Host path hidden by browser",
};
export const PROBE_PICKER_TIMEOUT_MS = 18_000;
export const PROBE_READ_TIMEOUT_MS = 5_000;
export const PROBE_REFRESH_TIMEOUT_MS = 18_000;

export function cardClassName(extra = ""): string {
  return [
    "rounded-[18px] bg-[var(--panel)] px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)]",
    extra,
  ].join(" ");
}

export function transportLabel(value: FlashTransportMode): string {
  return value === "local_usb" ? "Local USB" : "Web Serial";
}

export function probeToneClass(value: ProbeKind): string {
  switch (value) {
    case "recognized":
      return "border-[var(--surface-success-ring)] bg-[var(--surface-success-bg)] text-[var(--text)]";
    case "non_project":
      return "border-[var(--surface-warning-ring)] bg-[var(--surface-warning-bg)] text-[var(--text)]";
    case "unknown":
      return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]";
    case "probing":
      return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]";
    default:
      return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]";
  }
}

export function classifyProbe(
  value: unknown,
  fallbackMessage: string,
  hardware?: HardwareBoardInfo,
): ProbeState {
  const root =
    value && typeof value === "object"
      ? ((value as { result?: unknown }).result ?? value)
      : null;
  const device =
    root && typeof root === "object"
      ? ((root as { device?: unknown }).device ?? root)
      : null;
  if (!device || typeof device !== "object") {
    return {
      kind: "unknown",
      summary: hardware
        ? "Hardware probe succeeded, firmware identity is unavailable."
        : "Target identity could not be confirmed.",
      detail: fallbackMessage,
      mac: hardware?.macAddress,
      hardware,
    };
  }
  const record = device as Record<string, unknown>;
  const firmware =
    record.firmware && typeof record.firmware === "object"
      ? (record.firmware as Record<string, unknown>)
      : null;
  const firmwareName =
    typeof firmware?.name === "string" ? firmware.name : undefined;
  const firmwareVersion =
    typeof firmware?.version === "string" ? firmware.version : undefined;
  const deviceId =
    typeof record.device_id === "string"
      ? (record.device_id as string)
      : undefined;
  const mac =
    typeof record.mac === "string" ? (record.mac as string) : undefined;
  const hostname =
    typeof record.hostname === "string"
      ? (record.hostname as string)
      : undefined;
  const fqdn =
    typeof record.fqdn === "string" ? (record.fqdn as string) : undefined;
  const variant =
    typeof record.variant === "string" ? (record.variant as string) : undefined;
  const wifi =
    record.wifi && typeof record.wifi === "object"
      ? (record.wifi as Record<string, unknown>)
      : null;
  const wifiIpv4 =
    typeof wifi?.ipv4 === "string" ? (wifi.ipv4 as string) : undefined;
  const customHardwareName =
    (typeof record.name === "string" ? (record.name as string) : undefined) ??
    (typeof record.display_name === "string"
      ? (record.display_name as string)
      : undefined) ??
    (record.hardware &&
    typeof record.hardware === "object" &&
    typeof (record.hardware as Record<string, unknown>).name === "string"
      ? ((record.hardware as Record<string, unknown>).name as string)
      : undefined);

  if (firmwareName === "isolapurr-usb-hub") {
    return {
      kind: "recognized",
      summary: "Confirmed IsolaPurr target.",
      detail: `${firmwareName} ${firmwareVersion ?? "unknown"}${
        deviceId ? ` • ${deviceId}` : ""
      }`,
      deviceId,
      mac: mac ?? hardware?.macAddress,
      firmwareName,
      firmwareVersion,
      hostname,
      fqdn,
      variant,
      wifiIpv4,
      customHardwareName,
      hardware,
    };
  }
  if (firmwareName) {
    return {
      kind: "non_project",
      summary: "Connected target is not running IsolaPurr firmware.",
      detail: `${firmwareName} ${firmwareVersion ?? "unknown"}`,
      deviceId,
      mac: mac ?? hardware?.macAddress,
      firmwareName,
      firmwareVersion,
      hostname,
      fqdn,
      variant,
      wifiIpv4,
      customHardwareName,
      hardware,
    };
  }
  return {
    kind: "unknown",
    summary: hardware
      ? "Hardware probe succeeded, but firmware identity is unavailable."
      : "Target replied without firmware identity.",
    detail: fallbackMessage,
    deviceId,
    mac: mac ?? hardware?.macAddress,
    hostname,
    fqdn,
    variant,
    wifiIpv4,
    customHardwareName,
    hardware,
  };
}

function probeDeviceRecord(value: unknown): Record<string, unknown> | null {
  const root =
    value && typeof value === "object"
      ? ((value as { result?: unknown }).result ?? value)
      : null;
  const device =
    root && typeof root === "object"
      ? ((root as { device?: unknown }).device ?? root)
      : null;
  return device && typeof device === "object"
    ? (device as Record<string, unknown>)
    : null;
}

function capacityFromBytes(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (value === 0) {
    return "Not detected";
  }
  const mib = value / (1024 * 1024);
  if (Number.isInteger(mib)) {
    return `${mib} MB`;
  }
  const kib = value / 1024;
  return Number.isInteger(kib) ? `${kib} KB` : `${value} bytes`;
}

export function hardwareFromFirmwareInfo(
  value: unknown,
  port?: SerialLikePort | null,
): HardwareBoardInfo | undefined {
  const device = probeDeviceRecord(value);
  if (!device) {
    return undefined;
  }
  const firmware =
    device.firmware && typeof device.firmware === "object"
      ? (device.firmware as Record<string, unknown>)
      : null;
  if (firmware?.name !== "isolapurr-usb-hub") {
    return undefined;
  }
  const macAddress = typeof device.mac === "string" ? device.mac : undefined;
  const reported =
    device.hardware && typeof device.hardware === "object"
      ? (device.hardware as Record<string, unknown>)
      : null;
  if (reported) {
    const mcuModel =
      typeof reported.mcu === "string" ? reported.mcu : undefined;
    return {
      source: "firmware",
      chipType: mcuModel,
      mcuModel,
      flashSize: capacityFromBytes(reported.flash_bytes),
      ramSize: capacityFromBytes(reported.ram_bytes),
      psramSize: capacityFromBytes(reported.psram_bytes),
      macAddress,
    };
  }

  const portInfo = port?.getInfo?.();
  if (
    device.variant === "tps-sw" &&
    portInfo?.usbVendorId === 0x303a &&
    portInfo.usbProductId === 0x1001
  ) {
    return {
      source: "firmware-profile",
      chipType: "ESP32-S3",
      mcuModel: "ESP32-S3",
      flashSize: "4 MB",
      ramSize: "512 KB",
      psramSize: "8 MB",
      macAddress,
    };
  }
  return undefined;
}

export function summaryValue(
  value: string | null | undefined,
  fallback = "—",
): string {
  return value && value.trim().length > 0 ? value : fallback;
}

export function boardValue(
  value: string | null | undefined,
  fallback: string,
): string | undefined {
  return value && value.trim().length > 0 ? value : fallback;
}

export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function formatElapsedTimestamp(
  startedAt: number,
  now = Date.now(),
): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function splitLogLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function updateProbeVersion(
  current: ProbeState,
  nextVersion: string | null,
): ProbeState {
  if (!nextVersion || current.kind !== "recognized") {
    return current;
  }
  return {
    ...current,
    firmwareVersion: nextVersion,
    detail: `${current.firmwareName ?? "isolapurr-usb-hub"} ${nextVersion}${
      current.deviceId ? ` • ${current.deviceId}` : ""
    }`,
  };
}

export function describeFlashProgress(
  progress: FirmwareFlashProgress,
): FlashActivity {
  if (progress.stage === "connecting") {
    return {
      status: "working",
      title: "Preparing browser flash session…",
      detail: progress.message,
      progressPercent: 9,
      indeterminate: true,
    };
  }
  if (progress.stage === "writing") {
    const ratio =
      progress.total && progress.total > 0
        ? Math.min(1, (progress.written ?? 0) / progress.total)
        : null;
    return {
      status: "working",
      title: "Writing firmware over Web Serial…",
      detail: progress.message,
      progressPercent: ratio === null ? 42 : 12 + ratio * 76,
      indeterminate: ratio === null,
    };
  }
  return {
    status: "working",
    title: "Finalizing browser flash session…",
    detail: progress.message,
    progressPercent: 94,
    indeterminate: false,
  };
}

export function isWebSerialPickerCancelledError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const candidate = err as { message?: unknown; name?: unknown };
  return (
    candidate.name === "NotFoundError" ||
    (typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("no port selected by the user"))
  );
}

export function formatUsbId(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value.toString(16).toUpperCase().padStart(4, "0");
}

export function describeWebSerialSelection(
  port: SerialLikePort | null | undefined,
): WebSerialSelectionState | null {
  const info = port?.getInfo?.();
  const vendorId = formatUsbId(info?.usbVendorId);
  const productId = formatUsbId(info?.usbProductId);
  if (vendorId === "303A" && productId === "1001") {
    return {
      summary: "ESP32-S3 USB JTAG/serial",
      detail: "VID 303A · PID 1001 · Host path hidden by browser",
    };
  }
  if (vendorId || productId) {
    return {
      summary: "Browser-authorized serial port",
      detail: [
        vendorId ? `VID ${vendorId}` : null,
        productId ? `PID ${productId}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }
  return {
    summary: "Browser-authorized serial port",
    detail: "Host path hidden by browser",
  };
}

export function normalizeFirmwareVersion(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^v/i, "");
}

export function resolveExpectedIdentity(
  currentDevice: StoredDevice | undefined,
  probe: ProbeState,
): { deviceId?: string; mac?: string } | undefined {
  const deviceId = currentDevice?.id ?? probe.deviceId;
  const mac = probe.mac;
  if (!deviceId && !mac) {
    return undefined;
  }
  return { deviceId, mac };
}

import type { StoredDevice } from "../domain/devices";
import type {
  FirmwareFlashProgress,
  HardwareBoardInfo,
  SerialLikePort,
} from "../domain/hardwareConsole";
