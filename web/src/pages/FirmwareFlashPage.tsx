import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router";
import { useDemoMode } from "../app/demo-mode";
import { useDemoNavigate } from "../app/demo-navigation";
import { useDevices } from "../app/devices-store";
import { tryBootstrapDesktopAgent } from "../domain/desktopAgent";
import type { StoredDevice } from "../domain/devices";
import type {
  BundledFirmwareAsset,
  BundledFirmwareManifest,
} from "../domain/firmwareBundle";
import {
  DEMO_BUNDLED_FIRMWARE_MANIFEST,
  emptyBundledFirmwareManifest,
  fetchBundledFirmwareAssetFile,
  loadBundledFirmwareManifest,
} from "../domain/firmwareBundle";
import {
  clearFlashTransportLock,
  clearGlobalFlashTransportLock,
  setFlashTransportLock,
  setGlobalFlashTransportLock,
} from "../domain/flashTransportLocks";
import {
  type FirmwareFlashProgress,
  flashBundledWithLocalUsb,
  flashWithLocalUsb,
  flashWithWebSerial,
  forgetGrantedWebSerialPort,
  getReusableGrantedWebSerialPort,
  type HardwareBoardInfo,
  isWebSerialSupported,
  listLocalUsbSerialPorts,
  probeWebSerialBoard,
  readLocalUsbBoardInfo,
  refreshGrantedWebSerialPort,
  requestNewWebSerialPort,
  requestWebSerialPort,
  type SerialLikePort,
  type SerialPortInfo,
  WebSerialJsonlTransport,
} from "../domain/hardwareConsole";
import { getLocalUsbDeviceLink } from "../domain/localUsbLinks";
import { readLocalUsbInfo } from "../ui/dialogs/AddDeviceDialog.helpers";
import {
  type FirmwareFlashLogEntry,
  FirmwareFlashLogPanel,
} from "../ui/panels/FirmwareFlashLogPanel";
import { FirmwareFlashTargetState } from "../ui/panels/FirmwareFlashTargetState";
import { FirmwareReleaseList } from "../ui/panels/FirmwareReleaseList";

type FlashTransportMode = "local_usb" | "web_serial";
type FirmwareSourceMode = "releases" | "local_file";
type FlashMode = "normal" | "recovery";
type FlashModeReason = "normal" | "manual_recovery" | "forced_recovery";
type ProbeKind = "idle" | "probing" | "recognized" | "non_project" | "unknown";
type WebSerialProbeMode = "picker" | "selected";
type PendingConnectionAction =
  | "local_usb_picker"
  | "local_usb_probe"
  | "web_usb_picker"
  | "web_usb_reconnect"
  | "web_usb_release"
  | null;
type ProbeActivityStage = "picker" | "probing" | "refreshing";
type FlashActivityStatus = "idle" | "working" | "success" | "error";

type ProbeState = {
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

type WebSerialSelectionState = {
  summary: string;
  detail: string;
};

type WebSerialProbeOptions = {
  refreshHardware: boolean;
  fallbackHardware?: HardwareBoardInfo;
  onPortReady?: () => void;
};

type WebSerialInfoResult = {
  ok: boolean;
  port: SerialLikePort;
  value?: unknown;
  error?: string;
};

type ProbeActivity = {
  stage: ProbeActivityStage;
  title: string;
  detail: string;
  deadlineAt: number;
};

type FlashActivity = {
  status: FlashActivityStatus;
  title: string;
  detail: string;
  progressPercent?: number | null;
  indeterminate?: boolean;
};

const DEMO_AUTHORIZED_WEB_USB_SELECTION: WebSerialSelectionState = {
  summary: "ESP32-S3 USB JTAG/serial",
  detail: "VID 303A · PID 1001 · Host path hidden by browser",
};
const PROBE_PICKER_TIMEOUT_MS = 18_000;
const PROBE_READ_TIMEOUT_MS = 14_000;
const PROBE_REFRESH_TIMEOUT_MS = 18_000;

function cardClassName(extra = ""): string {
  return [
    "rounded-[18px] bg-[var(--panel)] px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)]",
    extra,
  ].join(" ");
}

function transportLabel(value: FlashTransportMode): string {
  return value === "local_usb" ? "Local USB" : "Web Serial";
}

function probeToneClass(value: ProbeKind): string {
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

function classifyProbe(
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

function summaryValue(
  value: string | null | undefined,
  fallback = "—",
): string {
  return value && value.trim().length > 0 ? value : fallback;
}

function boardValue(
  value: string | null | undefined,
  fallback: string,
): string | undefined {
  return value && value.trim().length > 0 ? value : fallback;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatElapsedTimestamp(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function splitLogLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function updateProbeVersion(
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

function describeFlashProgress(progress: FirmwareFlashProgress): FlashActivity {
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

function isWebSerialPickerCancelledError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.toLowerCase().includes("no port selected by the user")
  );
}

function formatUsbId(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value.toString(16).toUpperCase().padStart(4, "0");
}

function describeWebSerialSelection(
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

function normalizeFirmwareVersion(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^v/i, "");
}

function resolveExpectedIdentity(
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

const primaryButtonClass =
  "flex items-center justify-center rounded-[10px] bg-[var(--primary)] px-4 text-[12px] font-bold text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-2)] disabled:bg-[var(--btn-disabled-fill)] disabled:text-[var(--btn-disabled-text)]";

const outlineButtonClass =
  "flex items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-4 text-[12px] font-bold text-[var(--text)] transition-colors hover:bg-[var(--panel-2)] disabled:border-[var(--border)] disabled:bg-[var(--btn-disabled-fill-soft)] disabled:text-[var(--btn-disabled-text)]";

function SpinnerIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} animate-spin`}
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="5.25"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1.5"
      />
      <path
        d="M13.25 8A5.25 5.25 0 0 0 8 2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ReconnectIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M13 5.5V2.75m0 0H10.25m2.75 0L10.9 4.85A4.75 4.75 0 1 0 12.75 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function RemoveIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M6.2 5.05 5.15 6.1a2.25 2.25 0 0 0 0 3.18 2.25 2.25 0 0 0 3.18 0l1.05-1.05m.42-2.28 1.05-1.05a2.25 2.25 0 0 1 3.18 0 2.25 2.25 0 0 1 0 3.18l-1.05 1.05M4.25 11.75l7.5-7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function FirmwareFlashPage() {
  const navigate = useDemoNavigate();
  const { enabled: demoEnabled } = useDemoMode();
  const { getDevice } = useDevices();
  const [searchParams] = useSearchParams();
  const requestedDeviceId = searchParams.get("deviceId") ?? undefined;
  const demoProbeReading =
    demoEnabled && searchParams.get("probe") === "reading";
  const demoAuthorizedWebUsb =
    demoEnabled &&
    (searchParams.get("webUsb") === "authorized" || demoProbeReading);
  const currentDevice = requestedDeviceId
    ? getDevice(requestedDeviceId)
    : undefined;
  const currentLocalUsbPath = currentDevice
    ? (getLocalUsbDeviceLink(currentDevice.id) ??
      currentDevice.transports?.localUsbPortPath)
    : undefined;
  const webSerialSupported = isWebSerialSupported();

  const [transportMode, setTransportMode] = useState<FlashTransportMode | null>(
    demoProbeReading ? "web_serial" : null,
  );
  const [sourceMode, setSourceMode] = useState<FirmwareSourceMode>("releases");
  const [flashMode, setFlashMode] = useState<FlashMode>("normal");
  const [flashModeReason, setFlashModeReason] =
    useState<FlashModeReason>("normal");
  const [manifest, setManifest] = useState<BundledFirmwareManifest>(
    demoEnabled
      ? DEMO_BUNDLED_FIRMWARE_MANIFEST
      : emptyBundledFirmwareManifest(),
  );
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState<string | null>(
    null,
  );
  const [localUsbPorts, setLocalUsbPorts] = useState<SerialPortInfo[]>([]);
  const [selectedLocalUsbPort, setSelectedLocalUsbPort] = useState(
    currentLocalUsbPath ?? "",
  );
  const [selectedWebSerialSelection, setSelectedWebSerialSelection] =
    useState<WebSerialSelectionState | null>(null);
  const [localUsbPickerOpen, setLocalUsbPickerOpen] = useState(false);
  const [webUsbPickerOpen, setWebUsbPickerOpen] = useState(false);
  const [pendingConnectionAction, setPendingConnectionAction] =
    useState<PendingConnectionAction>(null);
  const [probing, setProbing] = useState(demoProbeReading);
  const [probeActivity, setProbeActivity] = useState<ProbeActivity | null>(
    demoProbeReading
      ? {
          stage: "probing",
          title: "Reading target identity…",
          detail: "Waiting for the selected transport to respond.",
          deadlineAt: Date.now() + PROBE_READ_TIMEOUT_MS,
        }
      : null,
  );
  const [probeClock, setProbeClock] = useState(() => Date.now());
  const [probe, setProbe] = useState<ProbeState>(
    demoProbeReading
      ? {
          kind: "probing",
          summary: "Reading target identity…",
          detail: "Waiting for the selected transport to respond.",
        }
      : {
          kind: "idle",
          summary: "Target probe is waiting for a usable USB path.",
          detail:
            "Choose USB device or Web USB first so the page can probe the board.",
        },
  );
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [manualAddress, setManualAddress] = useState("0x10000");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [flashActivity, setFlashActivity] = useState<FlashActivity | null>(
    null,
  );
  const [flashLogs, setFlashLogs] = useState<FirmwareFlashLogEntry[]>([]);
  const [strongConfirmOpen, setStrongConfirmOpen] = useState(false);
  const [strongConfirmText, setStrongConfirmText] = useState("");
  const localUsbDialogRef = useRef<HTMLDialogElement>(null);
  const selectedWebSerialPortRef = useRef<SerialLikePort | null>(null);
  const readAuthorizedWebUsbRef = useRef<(() => Promise<void>) | null>(null);
  const webSerialBootstrapRef = useRef(false);
  const webSerialAutoReadRef = useRef(false);
  const flashLogSerialRef = useRef(0);
  const flashOperationStartedAtRef = useRef<number | null>(null);
  const pseudoFlashProgressTimerRef = useRef<number | null>(null);

  const clearPseudoFlashProgress = () => {
    if (pseudoFlashProgressTimerRef.current !== null) {
      window.clearInterval(pseudoFlashProgressTimerRef.current);
      pseudoFlashProgressTimerRef.current = null;
    }
  };

  const appendFlashLog = (
    message: string,
    level: FirmwareFlashLogEntry["level"] = "info",
  ) => {
    const startedAt = flashOperationStartedAtRef.current ?? Date.now();
    setFlashLogs((current) => [
      ...current,
      {
        id: `flash-log-${flashLogSerialRef.current++}`,
        timestampLabel: formatElapsedTimestamp(startedAt),
        level,
        message,
      },
    ]);
  };

  const appendFlashLogLines = (
    log: string,
    level: FirmwareFlashLogEntry["level"] = "info",
  ) => {
    splitLogLines(log).forEach((line) => {
      appendFlashLog(line, level);
    });
  };

  const startProbeActivity = (
    stage: ProbeActivityStage,
    title: string,
    detail: string,
    timeoutMs: number,
  ) => {
    setProbeClock(Date.now());
    setProbeActivity({
      stage,
      title,
      detail,
      deadlineAt: Date.now() + timeoutMs,
    });
  };

  useEffect(() => {
    if (!probeActivity) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setProbeClock(Date.now());
    }, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [probeActivity]);

  useEffect(() => {
    return () => {
      if (pseudoFlashProgressTimerRef.current !== null) {
        window.clearInterval(pseudoFlashProgressTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    if (demoEnabled) {
      setManifest(DEMO_BUNDLED_FIRMWARE_MANIFEST);
      setSelectedReleaseTag(
        DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0]?.tagName ?? null,
      );
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadBundledFirmwareManifest();
        if (cancelled) {
          return;
        }
        setManifest(next);
        setManifestError(null);
        setSelectedReleaseTag(
          (current) => current ?? next.releases[0]?.tagName ?? null,
        );
      } catch (err) {
        if (cancelled) {
          return;
        }
        setManifestError(
          err instanceof Error
            ? err.message
            : "Bundled firmware manifest failed to load.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoEnabled]);

  useEffect(() => {
    if (!currentLocalUsbPath) {
      return;
    }
    setSelectedLocalUsbPort((current) => current || currentLocalUsbPath);
  }, [currentLocalUsbPath]);

  useEffect(() => {
    if (!demoAuthorizedWebUsb) {
      return;
    }
    setSelectedWebSerialSelection(DEMO_AUTHORIZED_WEB_USB_SELECTION);
  }, [demoAuthorizedWebUsb]);

  useEffect(() => {
    if (!demoProbeReading) {
      return;
    }
    setTransportMode("web_serial");
    setProbing(true);
    setSelectedWebSerialSelection(DEMO_AUTHORIZED_WEB_USB_SELECTION);
    setProbe({
      kind: "probing",
      summary: "Reading target identity…",
      detail: "Waiting for the selected transport to respond.",
    });
    setProbeClock(Date.now());
    setProbeActivity({
      stage: "probing",
      title: "Reading target identity…",
      detail: "Waiting for the selected transport to respond.",
      deadlineAt: Date.now() + PROBE_READ_TIMEOUT_MS,
    });
  }, [demoProbeReading]);

  useEffect(() => {
    if (demoEnabled || !webSerialSupported || webSerialBootstrapRef.current) {
      return;
    }
    webSerialBootstrapRef.current = true;
    let cancelled = false;
    void (async () => {
      const granted = await getReusableGrantedWebSerialPort(
        selectedWebSerialPortRef.current,
      ).catch(() => null);
      if (!granted || cancelled) {
        return;
      }
      selectedWebSerialPortRef.current = granted;
      setSelectedWebSerialSelection(describeWebSerialSelection(granted));
    })();
    return () => {
      cancelled = true;
    };
  }, [demoEnabled, webSerialSupported]);

  useLayoutEffect(() => {
    if (!currentDevice?.id) {
      return;
    }
    if (transportMode === "web_serial") {
      setFlashTransportLock({
        deviceId: currentDevice.id,
        transport: "web_serial",
      });
      return () => {
        clearFlashTransportLock(currentDevice.id);
      };
    }
    clearFlashTransportLock(currentDevice.id);
    return undefined;
  }, [currentDevice?.id, transportMode]);

  useEffect(() => {
    if (transportMode !== "web_serial") {
      clearGlobalFlashTransportLock();
      return () => {
        clearGlobalFlashTransportLock();
      };
    }
    setGlobalFlashTransportLock("web_serial");
    return () => {
      clearGlobalFlashTransportLock();
    };
  }, [transportMode]);

  useEffect(() => {
    const dialog = localUsbDialogRef.current;
    if (!dialog) {
      return;
    }
    if (localUsbPickerOpen && !dialog.open) {
      dialog.showModal();
    }
    if (!localUsbPickerOpen && dialog.open) {
      dialog.close();
    }
  }, [localUsbPickerOpen]);

  const targetNeedsStrongConfirmation =
    probe.kind === "unknown" || probe.kind === "non_project";
  const recoveryFlow = flashMode === "recovery";

  useEffect(() => {
    if (targetNeedsStrongConfirmation) {
      if (flashMode !== "recovery" || flashModeReason === "normal") {
        setFlashMode("recovery");
        setFlashModeReason("forced_recovery");
      }
      return;
    }
    if (flashModeReason === "forced_recovery") {
      setFlashMode("normal");
      setFlashModeReason("normal");
    }
  }, [flashMode, flashModeReason, targetNeedsStrongConfirmation]);

  useEffect(() => {
    setManualAddress(recoveryFlow ? "0x0000" : "0x10000");
  }, [recoveryFlow]);

  const releaseChoices = useMemo(
    () =>
      recoveryFlow
        ? manifest.releases.filter((release) => Boolean(release.recovery))
        : manifest.releases,
    [recoveryFlow, manifest.releases],
  );

  useEffect(() => {
    if (releaseChoices.length === 0) {
      setSelectedReleaseTag(null);
      return;
    }
    if (
      selectedReleaseTag &&
      releaseChoices.some((release) => release.tagName === selectedReleaseTag)
    ) {
      return;
    }
    setSelectedReleaseTag(releaseChoices[0]?.tagName ?? null);
  }, [releaseChoices, selectedReleaseTag]);

  const selectedRelease = useMemo(
    () =>
      releaseChoices.find(
        (release) => release.tagName === selectedReleaseTag,
      ) ?? null,
    [releaseChoices, selectedReleaseTag],
  );

  const selectedAsset: BundledFirmwareAsset | null = recoveryFlow
    ? (selectedRelease?.recovery ?? null)
    : (selectedRelease?.app ?? null);
  const selectedLocalUsbPortInfo =
    localUsbPorts.find(
      (candidate) => candidate.path === selectedLocalUsbPort,
    ) ?? null;
  const webSerialReadyForManualRead =
    webSerialSupported &&
    selectedWebSerialSelection !== null &&
    transportMode !== "web_serial";

  const expectedIdentity = resolveExpectedIdentity(currentDevice, probe);
  const strongConfirmationRequired =
    recoveryFlow && targetNeedsStrongConfirmation;

  const probeLocalUsb = async (portPath = selectedLocalUsbPort) => {
    if (!portPath) {
      setProbe({
        kind: "idle",
        summary: "Choose a USB device first.",
        detail: "Select the exact ESP32-S3 USB path before probing the board.",
      });
      return;
    }
    if (demoEnabled) {
      await delayMs(900);
      setProbe({
        kind: "recognized",
        summary: "Confirmed IsolaPurr target.",
        detail: "isolapurr-usb-hub v0.5.0 • aabbcc001122",
        deviceId: "aabbcc001122",
        mac: "AA:BB:CC:DD:EE:FF",
        firmwareName: "isolapurr-usb-hub",
        firmwareVersion: "v0.5.0",
        hostname: "isolapurr-usb-hub-aabbcc001122",
        fqdn: "isolapurr-usb-hub-aabbcc001122.local",
        customHardwareName: "Bench Hub",
        hardware: {
          source: "espflash",
          chipType: "ESP32-S3 (QFN56)",
          mcuModel: "ESP32-S3",
          chipRevision: "v0.2",
          flashSize: "8 MB",
          ramSize: "512 KB",
          psramSize: "8 MB",
          macAddress: "AA:BB:CC:DD:EE:FF",
          crystalFrequency: "40 MHz",
          features: [
            "Wi-Fi",
            "BLE",
            "Embedded Flash 8MB",
            "Embedded PSRAM 8MB",
          ],
        },
      });
      return;
    }
    const agent = await tryBootstrapDesktopAgent();
    if (!agent) {
      throw new Error("Local USB service is not running.");
    }
    const port = localUsbPorts.find((candidate) => candidate.path === portPath);
    if (!port) {
      throw new Error("Selected Local USB path is no longer available.");
    }
    let info: unknown = null;
    let fallback = "Local USB target did not expose project firmware metadata.";
    try {
      info = await readLocalUsbInfo(agent, port, () => undefined, 1);
    } catch (err) {
      fallback =
        err instanceof Error
          ? err.message
          : "Local USB target did not expose project firmware metadata.";
    }

    let hardware: HardwareBoardInfo | undefined;
    try {
      hardware = await readLocalUsbBoardInfo(agent, port.path);
      if (info != null) {
        try {
          info = await readLocalUsbInfo(agent, port, () => undefined, 5);
        } catch (err) {
          fallback =
            err instanceof Error
              ? err.message
              : "Local USB target did not expose project firmware metadata.";
        }
      }
    } catch {
      // Keep the confirmed firmware identity even when board-info is unavailable.
    }

    const nextProbe = classifyProbe(info, fallback, hardware);
    setProbe(nextProbe);
    return nextProbe;
  };

  const probeWebSerial = async (
    mode: WebSerialProbeMode,
    onPortReady?: () => void,
  ) => {
    if (demoEnabled) {
      await delayMs(900);
      const nextProbe: ProbeState = {
        kind: "recognized",
        summary: "Confirmed IsolaPurr target.",
        detail: "isolapurr-usb-hub v0.5.1 • demo Web Serial link",
        deviceId: "aabbcc001122",
        mac: "AA:BB:CC:DD:EE:FF",
        firmwareName: "isolapurr-usb-hub",
        firmwareVersion: "v0.5.1",
        hostname: "isolapurr-usb-hub-aabbcc001122",
        fqdn: "isolapurr-usb-hub-aabbcc001122.local",
        customHardwareName: "Bench Hub",
        hardware: {
          source: "esptool-js",
          chipType: "ESP32-S3 (QFN56)",
          mcuModel: "ESP32-S3",
          chipRevision: "v0.2",
          flashSize: "8 MB",
          ramSize: "512 KB",
          psramSize: "8 MB",
          macAddress: "AA:BB:CC:DD:EE:FF",
          crystalFrequency: "40 MHz",
          features: [
            "Wi-Fi",
            "BLE",
            "Embedded Flash 8MB",
            "Embedded PSRAM 8MB",
          ],
        },
      };
      setProbe(nextProbe);
      return nextProbe;
    }
    if (!webSerialSupported) {
      throw new Error("Web Serial is not supported by this browser.");
    }
    const readInfoFromWebSerialPort = async (
      port: SerialLikePort,
      maxAttempts: number,
      timeoutMs: number,
    ): Promise<WebSerialInfoResult> => {
      let candidatePort = port;
      let lastError =
        "Web Serial target did not expose project firmware metadata.";
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const transport = new WebSerialJsonlTransport();
        let tookPort = false;
        try {
          await transport.connectToPort(candidatePort);
          const value = await transport.request({
            id: Math.floor(Math.random() * 1_000_000_000),
            method: "info",
            timeoutMs: timeoutMs + attempt * 600,
          });
          candidatePort = await transport.takePortForExclusiveUse();
          tookPort = true;
          return { ok: true, port: candidatePort, value };
        } catch (err) {
          lastError =
            err instanceof Error
              ? err.message
              : "Web Serial target did not expose project firmware metadata.";
        } finally {
          if (!tookPort) {
            await transport.disconnect().catch(() => undefined);
          }
        }
        candidatePort = await refreshGrantedWebSerialPort(candidatePort).catch(
          () => candidatePort,
        );
        await delayMs(250 * (attempt + 1));
      }
      return {
        ok: false,
        port: candidatePort,
        error: lastError,
      };
    };

    const connectPort = async (
      port: SerialLikePort,
      options: WebSerialProbeOptions,
    ) => {
      let infoResult = await readInfoFromWebSerialPort(port, 2, 1_200);
      let activePort = infoResult.port;
      let hardware = options.fallbackHardware;
      if (options.refreshHardware) {
        hardware = await probeWebSerialBoard(activePort).catch(() => undefined);
        activePort = await refreshGrantedWebSerialPort(activePort).catch(
          () => activePort,
        );
        setSelectedWebSerialSelection(describeWebSerialSelection(activePort));
        const resumedInfo = await readInfoFromWebSerialPort(
          activePort,
          4,
          1_600,
        );
        activePort = resumedInfo.port;
        if (resumedInfo.ok) {
          infoResult = resumedInfo;
        } else if (infoResult.ok) {
          infoResult = {
            ok: false,
            port: activePort,
            error: `Hardware probe completed, but firmware did not resume after reset: ${resumedInfo.error}`,
          };
        } else {
          infoResult = resumedInfo;
        }
      }
      if (!infoResult.ok && !hardware) {
        throw new Error(infoResult.error);
      }
      setSelectedWebSerialSelection(describeWebSerialSelection(activePort));
      return {
        port: activePort,
        probe: classifyProbe(
          infoResult.ok ? infoResult.value : null,
          infoResult.ok
            ? "Web Serial target did not expose project firmware metadata."
            : (infoResult.error ??
                "Web Serial target did not expose project firmware metadata."),
          hardware,
        ),
      };
    };

    if (mode === "selected") {
      const selectedPort = selectedWebSerialPortRef.current;
      if (!selectedPort) {
        throw new Error(
          "Open Web USB first and choose the exact ESP32-S3 target.",
        );
      }
      const candidate = await connectPort(
        await refreshGrantedWebSerialPort(selectedPort),
        {
          refreshHardware: true,
        },
      );
      selectedWebSerialPortRef.current = candidate.port;
      setSelectedWebSerialSelection(describeWebSerialSelection(candidate.port));
      setProbe(candidate.probe);
      return candidate.probe;
    }

    const port =
      mode === "picker"
        ? await requestNewWebSerialPort()
        : await requestWebSerialPort(selectedWebSerialPortRef.current);
    selectedWebSerialPortRef.current = port;
    if (onPortReady) {
      flushSync(() => {
        onPortReady();
      });
    }
    setSelectedWebSerialSelection(describeWebSerialSelection(port));
    startProbeActivity(
      "probing",
      "Reading target identity…",
      "Waiting for the selected transport to respond.",
      PROBE_READ_TIMEOUT_MS,
    );
    setProbe({
      kind: "probing",
      summary: "Reading target identity…",
      detail: "Waiting for the selected transport to respond.",
    });
    const candidate = await connectPort(port, {
      refreshHardware: true,
    });
    selectedWebSerialPortRef.current = candidate.port;
    setSelectedWebSerialSelection(describeWebSerialSelection(candidate.port));
    setProbe(candidate.probe);
    return candidate.probe;
  };

  const loadLocalUsbPortChoices = async (): Promise<SerialPortInfo[]> => {
    if (demoEnabled) {
      return [
        {
          path: "/dev/demo-aabbcc001122",
          label: "Bench recovery USB",
          vendorId: 0x303a,
          productId: 0x1001,
        },
        {
          path: "/dev/demo-ddeeff112233",
          label: "Second hub USB",
          vendorId: 0x303a,
          productId: 0x1001,
        },
      ];
    }
    const agent = await tryBootstrapDesktopAgent();
    if (!agent) {
      return [];
    }
    try {
      return await listLocalUsbSerialPorts(agent);
    } catch {
      return [];
    }
  };

  const openLocalUsbPicker = async () => {
    if (probing || flashBusy || localUsbPickerOpen || webUsbPickerOpen) {
      return;
    }
    setPendingConnectionAction("local_usb_picker");
    setTransportMode("local_usb");
    setFlashError(null);
    try {
      const ports = await loadLocalUsbPortChoices();
      setLocalUsbPorts(ports);
      setSelectedLocalUsbPort((current) => current || ports[0]?.path || "");
      setLocalUsbPickerOpen(true);
    } finally {
      setPendingConnectionAction(null);
    }
  };

  const openWebUsbPicker = async () => {
    if (probing || flashBusy || localUsbPickerOpen || webUsbPickerOpen) {
      return;
    }
    const previousTransport = transportMode;
    let pickerResolved = false;
    const dismissPickerPrompt = () => {
      if (pickerResolved) {
        return;
      }
      pickerResolved = true;
      setWebUsbPickerOpen(false);
    };
    setPendingConnectionAction("web_usb_picker");
    setFlashError(null);
    try {
      setWebUsbPickerOpen(true);
      await runProbe("web_serial", undefined, "picker", dismissPickerPrompt);
      if (currentDevice?.id) {
        setFlashTransportLock({
          deviceId: currentDevice.id,
          transport: "web_serial",
        });
      }
      setGlobalFlashTransportLock("web_serial");
      setTransportMode("web_serial");
    } catch (err) {
      if (!isWebSerialPickerCancelledError(err)) {
        throw err;
      }
      if (previousTransport === "local_usb") {
        clearGlobalFlashTransportLock();
      }
    } finally {
      dismissPickerPrompt();
      setPendingConnectionAction(null);
    }
  };

  const readAuthorizedWebUsb = async () => {
    if (probing || flashBusy || localUsbPickerOpen || webUsbPickerOpen) {
      return;
    }
    setPendingConnectionAction("web_usb_reconnect");
    setFlashError(null);
    try {
      if (demoEnabled) {
        setSelectedWebSerialSelection(DEMO_AUTHORIZED_WEB_USB_SELECTION);
        await runProbe("web_serial", undefined, "selected");
        setTransportMode("web_serial");
        return;
      }
      const reusablePort = await getReusableGrantedWebSerialPort(
        selectedWebSerialPortRef.current,
      ).catch(() => null);
      if (!reusablePort) {
        selectedWebSerialPortRef.current = null;
        setSelectedWebSerialSelection(null);
        if (transportMode === "web_serial") {
          setTransportMode(null);
        }
        setProbe({
          kind: "idle",
          summary: "No browser-authorized Web USB device is ready.",
          detail:
            "Click Web USB to choose a device in the browser picker first.",
        });
        return;
      }
      selectedWebSerialPortRef.current = reusablePort;
      setSelectedWebSerialSelection(describeWebSerialSelection(reusablePort));
      await runProbe("web_serial", undefined, "selected");
      if (currentDevice?.id) {
        setFlashTransportLock({
          deviceId: currentDevice.id,
          transport: "web_serial",
        });
      }
      setGlobalFlashTransportLock("web_serial");
      setTransportMode("web_serial");
    } finally {
      setPendingConnectionAction(null);
    }
  };

  const releaseAuthorizedWebUsb = async () => {
    if (probing || flashBusy || localUsbPickerOpen || webUsbPickerOpen) {
      return;
    }
    setPendingConnectionAction("web_usb_release");
    try {
      setFlashError(null);
      const portToForget = selectedWebSerialPortRef.current;
      selectedWebSerialPortRef.current = null;
      setSelectedWebSerialSelection(null);

      if (transportMode === "web_serial") {
        if (currentDevice?.id) {
          clearFlashTransportLock(currentDevice.id);
        }
        clearGlobalFlashTransportLock();
        setTransportMode(null);
        setProbe({
          kind: "idle",
          summary: "Target probe is waiting for a usable USB path.",
          detail:
            "Choose USB device or Web USB first so the page can probe the board.",
        });
      } else if (probe.kind === "idle") {
        setProbe({
          kind: "idle",
          summary: "Target probe is waiting for a usable USB path.",
          detail:
            "Choose USB device or Web USB first so the page can probe the board.",
        });
      }

      if (!demoEnabled) {
        await forgetGrantedWebSerialPort(portToForget).catch((err) => {
          setFlashError(
            err instanceof Error
              ? err.message
              : "Failed to release the browser Web USB device.",
          );
        });
      }
    } finally {
      setPendingConnectionAction(null);
    }
  };

  readAuthorizedWebUsbRef.current = readAuthorizedWebUsb;

  useEffect(() => {
    if (
      demoEnabled ||
      transportMode !== null ||
      !selectedWebSerialSelection ||
      webSerialAutoReadRef.current
    ) {
      return;
    }
    webSerialAutoReadRef.current = true;
    setProbe({
      kind: "probing",
      summary: "Reading target identity…",
      detail:
        "Reconnecting to the browser-authorized Web USB device after refresh.",
    });
    void readAuthorizedWebUsbRef.current?.();
  }, [demoEnabled, selectedWebSerialSelection, transportMode]);

  const selectLocalUsbPort = async (portPath: string) => {
    if (currentDevice?.id) {
      clearFlashTransportLock(currentDevice.id);
    }
    setPendingConnectionAction("local_usb_probe");
    setSelectedLocalUsbPort(portPath);
    setLocalUsbPickerOpen(false);
    try {
      await runProbe("local_usb", portPath);
    } finally {
      setPendingConnectionAction(null);
    }
  };

  const runProbe = async (
    nextTransport: FlashTransportMode | null = transportMode,
    nextPortPath?: string,
    webSerialMode: WebSerialProbeMode = "picker",
    onWebSerialPortReady?: () => void,
  ) => {
    if (!nextTransport) {
      setProbe({
        kind: "idle",
        summary: "Target probe is waiting for a usable USB path.",
        detail:
          "Choose USB device or Web USB first so the page can probe the board.",
      });
      return;
    }
    setProbing(true);
    setFlashError(null);
    try {
      if (nextTransport === "web_serial" && webSerialMode === "picker") {
        startProbeActivity(
          "picker",
          "Waiting for browser device selection…",
          "Choose the exact ESP32-S3 USB device in the browser dialog to start probing.",
          PROBE_PICKER_TIMEOUT_MS,
        );
        setProbe({
          kind: "idle",
          summary: "Waiting for browser device selection…",
          detail:
            "Choose the exact ESP32-S3 USB device in the browser dialog to start probing.",
        });
      } else {
        startProbeActivity(
          "probing",
          "Reading target identity…",
          "Waiting for the selected transport to respond.",
          PROBE_READ_TIMEOUT_MS,
        );
        setProbe({
          kind: "probing",
          summary: "Reading target identity…",
          detail: "Waiting for the selected transport to respond.",
        });
      }
      if (nextTransport === "local_usb") {
        await probeLocalUsb(nextPortPath);
      } else {
        await probeWebSerial(webSerialMode, onWebSerialPortReady);
      }
    } catch (err) {
      if (isWebSerialPickerCancelledError(err)) {
        throw err;
      }
      setProbe({
        kind: "unknown",
        summary: "Target identity could not be confirmed.",
        detail: err instanceof Error ? err.message : "Probe failed.",
      });
    } finally {
      setProbeActivity(null);
      setProbing(false);
    }
  };

  const refreshProbeAfterFlash = async (
    nextTransport: FlashTransportMode | null,
  ) => {
    if (!nextTransport) {
      return;
    }
    let lastError: unknown;
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          startProbeActivity(
            "refreshing",
            "Refreshing target identity…",
            "Waiting for the board to reboot after flashing.",
            PROBE_REFRESH_TIMEOUT_MS,
          );
          setProbe({
            kind: "probing",
            summary: "Refreshing target identity…",
            detail: "Waiting for the board to reboot after flashing.",
          });
          const refreshed =
            nextTransport === "local_usb"
              ? await probeLocalUsb(selectedLocalUsbPort)
              : await (async () => {
                  const selectedPort = selectedWebSerialPortRef.current;
                  if (!selectedPort) {
                    throw new Error(
                      "Open Web USB first and choose the exact ESP32-S3 target.",
                    );
                  }
                  const transport = await refreshGrantedWebSerialPort(
                    selectedPort,
                  ).catch(() => selectedPort);
                  const candidate = await (async () => {
                    const transportResult = new WebSerialJsonlTransport();
                    let tookPort = false;
                    try {
                      await transportResult.connectToPort(transport);
                      const value = await transportResult.request({
                        id: Math.floor(Math.random() * 1_000_000_000),
                        method: "info",
                        timeoutMs: 2_000 + attempt * 600,
                      });
                      const reusablePort =
                        await transportResult.takePortForExclusiveUse();
                      tookPort = true;
                      selectedWebSerialPortRef.current = reusablePort;
                      setSelectedWebSerialSelection(
                        describeWebSerialSelection(reusablePort),
                      );
                      const refreshedProbe = classifyProbe(
                        value,
                        "Web Serial target did not expose project firmware metadata.",
                        probe.hardware,
                      );
                      setProbe(refreshedProbe);
                      return refreshedProbe;
                    } finally {
                      if (!tookPort) {
                        await transportResult
                          .disconnect()
                          .catch(() => undefined);
                      }
                    }
                  })();
                  return candidate;
                })();
          if (!refreshed) {
            throw new Error("Target refresh did not return probe data.");
          }
          const expectedVersion =
            sourceMode === "releases"
              ? normalizeFirmwareVersion(selectedRelease?.version)
              : null;
          const observedVersion = normalizeFirmwareVersion(
            refreshed?.firmwareVersion,
          );
          if (expectedVersion && observedVersion !== expectedVersion) {
            throw new Error(
              observedVersion
                ? `Target still reports firmware ${refreshed.firmwareVersion}.`
                : "Target has not reported the flashed firmware version yet.",
            );
          }
          return;
        } catch (err) {
          lastError = err;
          await delayMs(450 * (attempt + 1));
        }
      }
    } finally {
      setProbeActivity(null);
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Target identity refresh failed after flashing.");
  };

  const performFlash = async (confirmNonProjectFirmware: boolean) => {
    const resetFlashRun = () => {
      clearPseudoFlashProgress();
      flashOperationStartedAtRef.current = Date.now();
      flashLogSerialRef.current = 0;
      setFlashLogs([]);
      setFlashActivity({
        status: "working",
        title: "Preparing firmware write…",
        detail: "Validating the selected transport and firmware source.",
        progressPercent: 4,
        indeterminate: true,
      });
    };

    const beginBridgeProgress = (title: string, detail: string) => {
      clearPseudoFlashProgress();
      setFlashActivity({
        status: "working",
        title,
        detail,
        progressPercent: 18,
        indeterminate: false,
      });
      pseudoFlashProgressTimerRef.current = window.setInterval(() => {
        setFlashActivity((current) => {
          if (!current || current.status !== "working") {
            return current;
          }
          return {
            ...current,
            progressPercent: Math.min(
              82,
              Math.max(18, (current.progressPercent ?? 18) + 4),
            ),
          };
        });
      }, 700);
    };

    const runDemoFlash = async (
      selectionLabel: string,
      flashedVersion: string | null,
    ) => {
      setFlashActivity({
        status: "working",
        title: "Preparing demo flash…",
        detail: `Loading ${selectionLabel} for a simulated flash session.`,
        progressPercent: 12,
        indeterminate: false,
      });
      await delayMs(380);
      appendFlashLog(`Demo asset ready: ${selectionLabel}.`);
      if (transportMode === "local_usb") {
        beginBridgeProgress(
          "Writing through Local USB bridge…",
          "Demo bridge is replaying the selected flash sequence.",
        );
      } else {
        setFlashActivity({
          status: "working",
          title: "Writing firmware over Web Serial…",
          detail: "Demo transport is replaying browser-side flash progress.",
          progressPercent: 28,
          indeterminate: false,
        });
      }
      for (const percent of [32, 49, 66, 81, 93]) {
        await delayMs(340);
        setFlashActivity({
          status: "working",
          title:
            transportMode === "local_usb"
              ? "Writing through Local USB bridge…"
              : "Writing firmware over Web Serial…",
          detail:
            transportMode === "local_usb"
              ? "Demo bridge is replaying the selected flash sequence."
              : "Demo transport is replaying browser-side flash progress.",
          progressPercent: percent,
          indeterminate: false,
        });
        appendFlashLog(
          percent >= 90
            ? "Verifying the flashed image and rebooting the target."
            : `Programming flash blocks… ${percent}%`,
        );
      }
      clearPseudoFlashProgress();
      setFlashActivity({
        status: "working",
        title: "Refreshing target identity…",
        detail: "Demo target is rebooting to confirm the flashed firmware.",
        progressPercent: 97,
        indeterminate: false,
      });
      await delayMs(480);
      setProbe((current) => updateProbeVersion(current, flashedVersion));
      appendFlashLog(
        flashedVersion
          ? `Demo target now reports firmware ${flashedVersion}.`
          : "Demo flash sequence completed.",
        "success",
      );
      setFlashActivity({
        status: "success",
        title: "Demo flash completed.",
        detail: "Demo target identity was refreshed successfully.",
        progressPercent: 100,
        indeterminate: false,
      });
    };

    setFlashBusy(true);
    setFlashError(null);
    resetFlashRun();
    try {
      appendFlashLog(
        recoveryFlow
          ? "Recovery mode armed for this flash session."
          : "Normal update mode armed for this flash session.",
      );
      if (sourceMode === "releases") {
        if (!selectedRelease || !selectedAsset) {
          throw new Error("Choose a bundled firmware release first.");
        }
        appendFlashLog(
          `Selected bundled release ${selectedRelease.tagName} (${selectedAsset.fileName}).`,
        );

        if (demoEnabled) {
          await runDemoFlash(
            `${selectedRelease.tagName} (${selectedAsset.fileName})`,
            normalizeFirmwareVersion(selectedRelease.version),
          );
          return;
        }

        if (transportMode === "local_usb") {
          const agent = await tryBootstrapDesktopAgent();
          if (!agent || !selectedLocalUsbPort) {
            throw new Error("Select a Local USB target first.");
          }
          setFlashActivity({
            status: "working",
            title: "Preparing bundled release…",
            detail:
              "Loading the bundled app image before handing off to Local USB.",
            progressPercent: 12,
            indeterminate: false,
          });
          await delayMs(60);
          appendFlashLog("Bundled release is ready for Local USB flashing.");
          beginBridgeProgress(
            "Writing through Local USB bridge…",
            "Desktop bridge is programming the selected ESP32-S3 target.",
          );
          const log = await flashBundledWithLocalUsb(
            agent,
            selectedLocalUsbPort,
            selectedRelease,
            selectedAsset,
            recoveryFlow,
            expectedIdentity,
            confirmNonProjectFirmware,
          );
          clearPseudoFlashProgress();
          appendFlashLogLines(log);
          setFlashActivity({
            status: "working",
            title: "Refreshing target identity…",
            detail:
              "The board is rebooting so the page can verify the flashed firmware.",
            progressPercent: 96,
            indeterminate: false,
          });
          await refreshProbeAfterFlash("local_usb").catch((err) => {
            appendFlashLog(
              err instanceof Error
                ? `Target refresh failed: ${err.message}`
                : "Target refresh failed after flash.",
              "error",
            );
          });
          appendFlashLog("Bundled release flash completed.", "success");
          setFlashActivity({
            status: "success",
            title: "Bundled release flash completed.",
            detail: "Local USB write finished and the target was re-read.",
            progressPercent: 100,
            indeterminate: false,
          });
          return;
        }
        const port = selectedWebSerialPortRef.current;
        if (!port) {
          throw new Error(
            "Open Web USB first and choose the exact ESP32-S3 target.",
          );
        }
        const refreshedPort = await refreshGrantedWebSerialPort(port);
        selectedWebSerialPortRef.current = refreshedPort;
        const file = await fetchBundledFirmwareAssetFile(selectedAsset);
        appendFlashLog("Streaming bundled release over Web Serial.");
        let lastWebSerialStage = "";
        let lastWebSerialBucket = -1;
        await flashWithWebSerial(
          refreshedPort,
          file,
          selectedAsset.flashAddress,
          (progress) => {
            setFlashActivity(describeFlashProgress(progress));
            const ratio =
              progress.total && progress.total > 0
                ? Math.round(((progress.written ?? 0) / progress.total) * 100)
                : null;
            if (
              progress.stage === "connecting" &&
              lastWebSerialStage !== "connecting"
            ) {
              lastWebSerialStage = "connecting";
              appendFlashLog(progress.message);
              return;
            }
            if (progress.stage === "done") {
              lastWebSerialStage = "done";
              appendFlashLog(progress.message, "success");
              return;
            }
            if (ratio !== null) {
              const bucket = Math.floor(ratio / 20);
              if (bucket > lastWebSerialBucket) {
                lastWebSerialBucket = bucket;
                appendFlashLog(`${progress.message} ${ratio}%`);
              }
            } else if (lastWebSerialStage !== progress.stage) {
              lastWebSerialStage = progress.stage;
              appendFlashLog(progress.message);
            }
          },
        );
        setFlashActivity({
          status: "working",
          title: "Refreshing target identity…",
          detail:
            "The browser transport finished writing. Waiting for the target to reboot.",
          progressPercent: 96,
          indeterminate: false,
        });
        await refreshProbeAfterFlash("web_serial").catch((err) => {
          appendFlashLog(
            err instanceof Error
              ? `Target refresh failed: ${err.message}`
              : "Target refresh failed after flash.",
            "error",
          );
        });
        appendFlashLog("Web Serial firmware flash completed.", "success");
        setFlashActivity({
          status: "success",
          title: "Web Serial firmware flash completed.",
          detail: "The page re-read the target after the browser-side write.",
          progressPercent: 100,
          indeterminate: false,
        });
        return;
      }

      if (!localFile) {
        throw new Error("Select a local firmware file first.");
      }
      appendFlashLog(`Selected local file ${localFile.name}.`);
      const address = Number.parseInt(manualAddress, 16);
      if (!Number.isFinite(address)) {
        throw new Error("Enter a valid hex flash address.");
      }
      if (demoEnabled) {
        await runDemoFlash(
          localFile.name,
          normalizeFirmwareVersion(probe.firmwareVersion),
        );
        return;
      }
      if (transportMode === "local_usb") {
        const agent = await tryBootstrapDesktopAgent();
        if (!agent || !selectedLocalUsbPort) {
          throw new Error("Select a Local USB target first.");
        }
        if (recoveryFlow) {
          throw new Error(
            "Local file recovery is only available over Web Serial in this workbench.",
          );
        }
        beginBridgeProgress(
          "Writing local file through Local USB bridge…",
          "Desktop bridge is programming the selected app image.",
        );
        const log = await flashWithLocalUsb(
          agent,
          selectedLocalUsbPort,
          localFile,
          address,
          expectedIdentity ?? {},
        );
        clearPseudoFlashProgress();
        appendFlashLogLines(log);
        setFlashActivity({
          status: "working",
          title: "Refreshing target identity…",
          detail:
            "The board is rebooting so the page can verify the local file write.",
          progressPercent: 96,
          indeterminate: false,
        });
        await refreshProbeAfterFlash("local_usb").catch((err) => {
          appendFlashLog(
            err instanceof Error
              ? `Target refresh failed: ${err.message}`
              : "Target refresh failed after flash.",
            "error",
          );
        });
        appendFlashLog("Local USB firmware flash completed.", "success");
        setFlashActivity({
          status: "success",
          title: "Local USB firmware flash completed.",
          detail:
            "The uploaded app image was written and the target was re-read.",
          progressPercent: 100,
          indeterminate: false,
        });
        return;
      }
      const port = selectedWebSerialPortRef.current;
      if (!port) {
        throw new Error(
          "Open Web USB first and choose the exact ESP32-S3 target.",
        );
      }
      const refreshedPort = await refreshGrantedWebSerialPort(port);
      selectedWebSerialPortRef.current = refreshedPort;
      appendFlashLog("Streaming local file over Web Serial.");
      let lastWebSerialStage = "";
      let lastWebSerialBucket = -1;
      await flashWithWebSerial(
        refreshedPort,
        localFile,
        address,
        (progress) => {
          setFlashActivity(describeFlashProgress(progress));
          const ratio =
            progress.total && progress.total > 0
              ? Math.round(((progress.written ?? 0) / progress.total) * 100)
              : null;
          if (
            progress.stage === "connecting" &&
            lastWebSerialStage !== "connecting"
          ) {
            lastWebSerialStage = "connecting";
            appendFlashLog(progress.message);
            return;
          }
          if (progress.stage === "done") {
            lastWebSerialStage = "done";
            appendFlashLog(progress.message, "success");
            return;
          }
          if (ratio !== null) {
            const bucket = Math.floor(ratio / 20);
            if (bucket > lastWebSerialBucket) {
              lastWebSerialBucket = bucket;
              appendFlashLog(`${progress.message} ${ratio}%`);
            }
          } else if (lastWebSerialStage !== progress.stage) {
            lastWebSerialStage = progress.stage;
            appendFlashLog(progress.message);
          }
        },
      );
      setFlashActivity({
        status: "working",
        title: "Refreshing target identity…",
        detail:
          "The browser transport finished writing. Waiting for the target to reboot.",
        progressPercent: 96,
        indeterminate: false,
      });
      await refreshProbeAfterFlash("web_serial").catch((err) => {
        appendFlashLog(
          err instanceof Error
            ? `Target refresh failed: ${err.message}`
            : "Target refresh failed after flash.",
          "error",
        );
      });
      appendFlashLog("Web Serial firmware flash completed.", "success");
      setFlashActivity({
        status: "success",
        title: "Web Serial firmware flash completed.",
        detail:
          "The uploaded app image was written and the target was re-read.",
        progressPercent: 100,
        indeterminate: false,
      });
    } catch (err) {
      clearPseudoFlashProgress();
      const message =
        err instanceof Error ? err.message : "Firmware flash failed.";
      setFlashError(message);
      appendFlashLog(message, "error");
      setFlashActivity((current) => ({
        status: "error",
        title: "Flash failed.",
        detail: message,
        progressPercent: current?.progressPercent ?? 0,
        indeterminate: false,
      }));
    } finally {
      clearPseudoFlashProgress();
      setFlashBusy(false);
    }
  };

  const onFlash = async () => {
    if (strongConfirmationRequired) {
      setStrongConfirmOpen(true);
      return;
    }
    await performFlash(false);
  };

  const transportSummary =
    transportMode === null ? "Not connected" : transportLabel(transportMode);
  const selectedVersionLabel =
    sourceMode === "releases"
      ? summaryValue(selectedRelease?.version)
      : summaryValue(localFile?.name);
  const selectedSourceLabel =
    sourceMode === "releases" ? "Bundled release" : "Local file";
  const flashModeLabel = recoveryFlow ? "Recovery" : "Normal update";
  const confirmationLabel = strongConfirmationRequired
    ? "Strong confirm"
    : "Confirm";
  const addressLabel =
    sourceMode === "releases"
      ? summaryValue(
          selectedAsset
            ? `0x${selectedAsset.flashAddress.toString(16).toUpperCase()}`
            : null,
          manualAddress,
        )
      : summaryValue(manualAddress);
  const operationLocked =
    probing || flashBusy || webUsbPickerOpen || localUsbPickerOpen;
  const localUsbActionBusy =
    pendingConnectionAction === "local_usb_picker" ||
    pendingConnectionAction === "local_usb_probe" ||
    (probing && transportMode === "local_usb");
  const webUsbActionBusy =
    pendingConnectionAction === "web_usb_picker" ||
    pendingConnectionAction === "web_usb_reconnect" ||
    pendingConnectionAction === "web_usb_release" ||
    webUsbPickerOpen ||
    (probing &&
      (transportMode === "web_serial" || Boolean(selectedWebSerialSelection)));
  const reconnectButtonBusy =
    pendingConnectionAction === "web_usb_reconnect" ||
    (probing &&
      transportMode === "web_serial" &&
      Boolean(selectedWebSerialSelection));
  const localUsbStatusLabel =
    pendingConnectionAction === "local_usb_picker"
      ? "Loading"
      : localUsbActionBusy
        ? "Detecting"
        : transportMode === "local_usb" && selectedLocalUsbPort
          ? "Selected"
          : "Available";
  const localUsbDescription =
    pendingConnectionAction === "local_usb_picker"
      ? "Reading available Local USB choices for the exact ESP32-S3 path."
      : pendingConnectionAction === "local_usb_probe"
        ? "Probing the selected Local USB path now."
        : "Pick the exact ESP32-S3 serial path.";
  const webUsbStatusLabel = !webSerialSupported
    ? "Unavailable"
    : webUsbPickerOpen || pendingConnectionAction === "web_usb_picker"
      ? "Selecting"
      : pendingConnectionAction === "web_usb_release"
        ? "Releasing"
        : webUsbActionBusy
          ? "Reading"
          : transportMode === "web_serial"
            ? "Selected"
            : selectedWebSerialSelection
              ? "Authorized"
              : "Available";
  const webUsbDescription = webUsbPickerOpen
    ? "Finish browser device selection to continue probing."
    : pendingConnectionAction === "web_usb_release"
      ? "Removing the saved browser authorization for this device."
      : reconnectButtonBusy
        ? "Reading the currently authorized browser device."
        : selectedWebSerialSelection
          ? "Authorized device is ready. Click to choose another device."
          : "Open the browser picker immediately.";
  const releaseButtonBusy = pendingConnectionAction === "web_usb_release";
  const probeCountdownSeconds =
    probeActivity === null || probeActivity.stage === "picker"
      ? null
      : Math.max(0, Math.ceil((probeActivity.deadlineAt - probeClock) / 1000));

  const canFlash =
    !operationLocked &&
    !(
      !transportMode ||
      (sourceMode === "releases" && !selectedAsset) ||
      (sourceMode === "local_file" && !localFile) ||
      probe.kind === "idle" ||
      probe.kind === "probing" ||
      probeActivity !== null ||
      (!recoveryFlow && probe.kind !== "recognized") ||
      (transportMode === "web_serial" && selectedAsset?.fileKind === "elf") ||
      (transportMode === "web_serial" && !webSerialSupported) ||
      (sourceMode === "local_file" &&
        recoveryFlow &&
        transportMode === "local_usb")
    );
  const idleProbeSummary =
    probe.kind === "idle" && webSerialReadyForManualRead
      ? "Authorized Web USB device is ready."
      : probe.summary;
  const idleProbeDetail =
    probe.kind === "idle" && webSerialReadyForManualRead
      ? "Reconnect to read board identity, or choose another device above."
      : probe.detail;
  const targetBadgeLabel =
    probeActivity?.stage === "picker"
      ? "Waiting"
      : probeActivity
        ? "Probing"
        : probe.kind === "recognized"
          ? "Confirmed"
          : probe.kind === "non_project"
            ? "Non-project"
            : probe.kind === "probing"
              ? "Probing"
              : probe.kind === "unknown"
                ? "Unconfirmed"
                : "Waiting";
  const flashLogTitle =
    flashActivity?.title ??
    (transportMode === "web_serial" && selectedAsset?.fileKind === "elf"
      ? "Web USB cannot write this recovery image."
      : flashError
        ? "Flash failed."
        : "Flash progress appears here.");
  const flashLogDetail = flashError
    ? flashError
    : (flashActivity?.detail ??
      (transportMode === "local_usb"
        ? "Use Local USB for bundled release flashing."
        : transportMode === "web_serial" && selectedAsset?.fileKind === "elf"
          ? "Selected recovery release is bundled as ELF. Use Local USB for desktop-assisted flashing."
          : transportMode === "web_serial"
            ? "Use Web USB when browser serial access is preferred."
            : "Choose a transport, probe the target, then flash firmware."));
  const flashLogStatus =
    flashError !== null
      ? "error"
      : (flashActivity?.status ??
        (flashBusy ? "working" : ("idle" as FlashActivityStatus)));
  const targetAction =
    probeActivity !== null ? null : webSerialReadyForManualRead ? (
      <button
        className={`${outlineButtonClass} min-h-11 w-full gap-2`}
        type="button"
        disabled={operationLocked}
        onClick={() => void readAuthorizedWebUsb()}
      >
        {reconnectButtonBusy ? (
          <ReconnectIcon className="h-4 w-4 animate-spin" />
        ) : (
          <ReconnectIcon />
        )}
        <span>
          {reconnectButtonBusy ? "Reading device info…" : "Reconnect"}
        </span>
      </button>
    ) : null;
  const targetRows = [
    {
      label: "MCU",
      value: probe.hardware
        ? boardValue(
            probe.hardware.mcuModel ?? probe.hardware.chipType,
            "Unknown",
          )
        : undefined,
    },
    {
      label: "Flash",
      value: probe.hardware
        ? boardValue(probe.hardware.flashSize, "Not reported")
        : undefined,
    },
    {
      label: "RAM",
      value: probe.hardware
        ? boardValue(probe.hardware.ramSize, "Not reported")
        : undefined,
    },
    {
      label: "PSRAM",
      value: probe.hardware
        ? boardValue(probe.hardware.psramSize, "Not detected")
        : undefined,
    },
    { label: "device_id", value: probe.deviceId, mono: true },
    {
      label: "MAC",
      value: probe.hardware?.macAddress ?? probe.mac,
      mono: true,
    },
    { label: "Hostname", value: probe.hostname, mono: true },
    { label: "IPv4", value: probe.wifiIpv4, mono: true },
    {
      label: "Firmware",
      value:
        probe.kind === "recognized"
          ? [probe.firmwareName, probe.firmwareVersion]
              .filter(Boolean)
              .join(" ")
          : probe.kind === "non_project"
            ? [probe.firmwareName, probe.firmwareVersion]
                .filter(Boolean)
                .join(" ")
            : undefined,
      mono: true,
    },
    {
      label: "Name",
      value: probe.kind === "recognized" ? probe.customHardwareName : undefined,
    },
  ].filter((row) => Boolean(row.value));
  const showTargetRows = probeActivity === null && targetRows.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="firmware-flash-page">
      <div>
        <div className="text-[24px] font-bold">Firmware flash</div>
        <div className="mt-1.5 max-w-[68ch] text-[13px] font-semibold leading-6 text-[var(--muted)]">
          Standalone USB flashing surface for first-time provisioning, recovery,
          and manual release install.
        </div>
        {currentDevice ? (
          <div className="mt-1.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
            Device context:{" "}
            <span className="text-[var(--text)]">
              {currentDevice.name} • {currentDevice.id}
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cardClassName()}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[18px] font-bold">Connection</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  Choose one USB transport first, then the page probes the board
                  and enables flashing.
                </div>
              </div>
              <div className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-5 text-[12px] font-bold text-[var(--muted)]">
                Two USB choices
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div>
                <TransportChoiceCard
                  title="USB device"
                  status={localUsbStatusLabel}
                  description={localUsbDescription}
                  selectionSummary={
                    transportMode === "local_usb" && selectedLocalUsbPort
                      ? (selectedLocalUsbPortInfo?.label ??
                        "Exact serial path selected")
                      : undefined
                  }
                  selectionDetail={
                    transportMode === "local_usb" && selectedLocalUsbPort
                      ? selectedLocalUsbPort
                      : undefined
                  }
                  busy={localUsbActionBusy}
                  disabled={operationLocked}
                  onClick={() => void openLocalUsbPicker()}
                />
              </div>
              <div>
                <TransportChoiceCard
                  title="Web USB"
                  status={webUsbStatusLabel}
                  description={webUsbDescription}
                  selectionSummary={selectedWebSerialSelection?.summary}
                  selectionDetail={selectedWebSerialSelection?.detail}
                  selectionActions={
                    selectedWebSerialSelection ? (
                      <>
                        {webSerialReadyForManualRead ? (
                          <button
                            aria-label="Reconnect device"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
                            title="Reconnect device"
                            type="button"
                            disabled={operationLocked}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void readAuthorizedWebUsb();
                            }}
                          >
                            <ReconnectIcon
                              className={
                                reconnectButtonBusy
                                  ? "h-4 w-4 animate-spin"
                                  : "h-4 w-4"
                              }
                            />
                          </button>
                        ) : null}
                        <button
                          aria-label="Release Web USB authorization"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
                          title="Release Web USB authorization"
                          type="button"
                          disabled={operationLocked}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void releaseAuthorizedWebUsb();
                          }}
                        >
                          <RemoveIcon
                            className={
                              releaseButtonBusy
                                ? "h-4 w-4 animate-pulse"
                                : "h-4 w-4"
                            }
                          />
                        </button>
                      </>
                    ) : null
                  }
                  busy={webUsbActionBusy}
                  disabled={operationLocked || !webSerialSupported}
                  onMouseDownActivate={() => void openWebUsbPicker()}
                  onClick={() => void openWebUsbPicker()}
                />
              </div>
            </div>
          </section>

          <section className={cardClassName()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[18px] font-bold">Target</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  After the USB path is ready, the page probes the board and
                  shows identity plus confirmation here.
                </div>
              </div>
              <div
                className={[
                  "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]",
                  probeToneClass(probeActivity ? "probing" : probe.kind),
                ].join(" ")}
              >
                {targetBadgeLabel}
              </div>
            </div>

            {showTargetRows ? (
              <dl className="mt-3 grid gap-x-5 gap-y-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {targetRows.map((row) => (
                  <TargetInfoCell
                    key={row.label}
                    label={row.label}
                    value={String(row.value)}
                    mono={row.mono}
                  />
                ))}
              </dl>
            ) : (
              <FirmwareFlashTargetState
                title={probeActivity?.title ?? idleProbeSummary}
                detail={probeActivity?.detail ?? idleProbeDetail}
                countdownSeconds={probeCountdownSeconds}
                busy={probeActivity !== null}
                action={targetAction}
                countdownEmphasis={probeActivity ? "aside" : "inline"}
              />
            )}
          </section>

          <section className={cardClassName()}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[18px] font-bold">Firmware source</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  Bundled release first. Local file only when needed.
                </div>
              </div>
              <div className="flex h-10 rounded-[14px] border border-[var(--border)] p-1">
                {(["releases", "local_file"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={[
                      "min-w-[120px] rounded-[10px] px-4 text-[12px] font-bold",
                      sourceMode === mode
                        ? "bg-[var(--primary)] text-[var(--primary-text)]"
                        : "text-[var(--text)]",
                    ].join(" ")}
                    type="button"
                    disabled={operationLocked}
                    onClick={() => setSourceMode(mode)}
                  >
                    {mode === "releases" ? "Releases" : "Local file"}
                  </button>
                ))}
              </div>
            </div>

            {sourceMode === "releases" ? (
              <div className="mt-4">
                {manifestError ? (
                  <div className="rounded-[14px] border border-[var(--error)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]">
                    {manifestError}
                  </div>
                ) : (
                  <FirmwareReleaseList
                    releases={releaseChoices}
                    selectedTag={selectedReleaseTag}
                    recoveryOnly={recoveryFlow}
                    disabled={operationLocked}
                    onSelect={setSelectedReleaseTag}
                  />
                )}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                <input
                  className="file-input file-input-sm h-12 w-full"
                  type="file"
                  accept=".bin,application/octet-stream"
                  disabled={operationLocked}
                  onChange={(event) =>
                    setLocalFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                <input
                  className="input input-sm h-12 w-full font-mono"
                  value={manualAddress}
                  disabled={operationLocked}
                  onChange={(event) => setManualAddress(event.target.value)}
                />
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className={cardClassName("h-full")}>
            <div className="text-[18px] font-bold">Flash</div>
            <div className="mt-1.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
              USB only. Default app address{" "}
              <span className="font-mono text-[var(--text)]">0x10000</span>.
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] p-1">
              {[
                {
                  key: "normal",
                  label: "Normal update",
                  active: !recoveryFlow,
                },
                { key: "recovery", label: "Recovery", active: recoveryFlow },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  disabled={
                    operationLocked ||
                    (targetNeedsStrongConfirmation && mode.key === "normal")
                  }
                  onClick={() => {
                    if (mode.key === "recovery") {
                      setFlashMode("recovery");
                      setFlashModeReason("manual_recovery");
                      return;
                    }
                    setFlashMode("normal");
                    setFlashModeReason("normal");
                  }}
                  className={[
                    "flex min-h-10 items-center justify-center rounded-[10px] px-3 text-[12px] font-bold transition-colors",
                    mode.active
                      ? "bg-[var(--primary)] text-[var(--primary-text)]"
                      : "text-[var(--text)] hover:bg-[var(--panel)] disabled:text-[var(--btn-disabled-text)] disabled:hover:bg-transparent",
                  ].join(" ")}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <div className="text-[14px] font-bold">Current selection</div>
              <div className="mt-2.5 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] font-semibold leading-5">
                <FlashSummaryRow label="transport" value={transportSummary} />
                <FlashSummaryRow label="mode" value={flashModeLabel} />
                <FlashSummaryRow label="source" value={selectedSourceLabel} />
                <FlashSummaryRow label="version" value={selectedVersionLabel} />
                <FlashSummaryRow label="confirm" value={confirmationLabel} />
                <FlashSummaryRow label="address" value={addressLabel} mono />
              </div>
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="text-[14px] font-bold">Safety check</div>
              <div className="mt-2 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                {strongConfirmationRequired
                  ? "Recovery mode is active on an unconfirmed target. Strong confirmation is required before write."
                  : recoveryFlow
                    ? "Recovery mode is active for this board. Recovery-capable releases rewrite the bundled recovery image."
                    : "Normal update mode is active. App-only release images write to 0x10000."}
              </div>
            </div>

            <div className="mt-4">
              <button
                className={`${primaryButtonClass} min-h-11 w-full gap-2`}
                type="button"
                disabled={!canFlash}
                onClick={() => void onFlash()}
              >
                {flashBusy ? (
                  <>
                    <SpinnerIcon />
                    <span>
                      {recoveryFlow
                        ? "Flashing recovery..."
                        : "Flashing firmware..."}
                    </span>
                  </>
                ) : recoveryFlow ? (
                  "Flash recovery firmware"
                ) : (
                  "Flash firmware"
                )}
              </button>

              <button
                className={`${outlineButtonClass} mt-3 min-h-11 w-full`}
                type="button"
                disabled={operationLocked}
                onClick={() =>
                  currentDevice
                    ? navigate(`/devices/${currentDevice.id}/info`)
                    : navigate("/")
                }
              >
                {currentDevice ? "Back to settings" : "Back to dashboard"}
              </button>
            </div>

            <FirmwareFlashLogPanel
              title={flashLogTitle}
              detail={flashLogDetail}
              status={flashLogStatus}
              progressPercent={flashActivity?.progressPercent ?? null}
              indeterminate={flashActivity?.indeterminate ?? false}
              entries={flashLogs}
              emptyText="Detailed flash log will appear here."
            />
          </section>
        </aside>
      </div>

      <dialog
        ref={localUsbDialogRef}
        className="modal modal-bottom sm:modal-middle"
        aria-label="Choose USB device"
        onCancel={(event) => {
          event.preventDefault();
          setLocalUsbPickerOpen(false);
        }}
        onClose={() => {
          if (localUsbPickerOpen) {
            setLocalUsbPickerOpen(false);
          }
        }}
        onClick={(event) => {
          if (event.target === localUsbDialogRef.current) {
            setLocalUsbPickerOpen(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== localUsbDialogRef.current) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setLocalUsbPickerOpen(false);
          }
        }}
      >
        <div className="modal-box iso-modal flex w-full max-w-[720px] flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)] px-6 pb-6 pt-5 sm:max-w-[calc(100vw-48px)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[20px] font-bold leading-7">
                Choose USB device
              </div>
              <div className="mt-2 text-[13px] font-medium leading-6 text-[var(--muted)]">
                Pick the exact ESP32-S3 serial path, then the page probes the
                board immediately.
              </div>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[18px] leading-none text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              type="button"
              aria-label="Close USB device picker"
              onClick={() => setLocalUsbPickerOpen(false)}
            >
              ×
            </button>
          </div>

          {localUsbPorts.length > 0 ? (
            <div className="mt-5 flex flex-col gap-3">
              {localUsbPorts.map((port) => {
                const selected = port.path === selectedLocalUsbPort;
                return (
                  <button
                    key={port.path}
                    className={[
                      "w-full rounded-[14px] border px-4 py-4 text-left transition-colors",
                      selected
                        ? "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_3%,var(--panel))]"
                        : "border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-2)]",
                    ].join(" ")}
                    type="button"
                    onClick={() => void selectLocalUsbPort(port.path)}
                  >
                    <div className="text-[14px] font-bold text-[var(--text)]">
                      {port.label}
                    </div>
                    <div className="mt-2 font-mono text-[12px] font-semibold text-[var(--muted)]">
                      {port.path}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4 text-[13px] font-semibold leading-6 text-[var(--muted)]">
              No Local USB device is available right now. Connect the target or
              open the desktop app, then try again.
            </div>
          )}
        </div>
      </dialog>

      {webUsbPickerOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/18 px-4 py-6"
          role="presentation"
          aria-hidden="true"
        >
          <div className="pointer-events-none w-full max-w-[360px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
            <div className="text-[18px] font-bold text-[var(--text)]">
              Waiting for browser picker
            </div>
            <div className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]">
              Confirm the ESP32-S3 USB device in the browser dialog on the
              right. The page probes hardware immediately after selection.
            </div>
          </div>
        </div>
      ) : null}

      {strongConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="presentation"
        >
          <div
            className="w-full max-w-[480px] rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="flash-strong-confirm-title"
            aria-describedby="flash-strong-confirm-description"
          >
            <div
              id="flash-strong-confirm-title"
              className="text-[16px] font-bold"
            >
              Flash a target that is not confirmed as IsolaPurr?
            </div>
            <div
              id="flash-strong-confirm-description"
              className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]"
            >
              This recovery write may target a download-mode board, damaged
              firmware, or non-IsolaPurr hardware. Type{" "}
              <span className="font-mono text-[var(--text)]">FLASH</span> to
              continue with the selected recovery image.
            </div>
            <input
              className="input input-sm mt-4 h-11 w-full font-mono"
              value={strongConfirmText}
              onChange={(event) => setStrongConfirmText(event.target.value)}
              placeholder="Type FLASH"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className={`${outlineButtonClass} min-h-11`}
                type="button"
                onClick={() => {
                  setStrongConfirmOpen(false);
                  setStrongConfirmText("");
                }}
              >
                Cancel
              </button>
              <button
                className={`${primaryButtonClass} min-h-11`}
                type="button"
                disabled={strongConfirmText.trim() !== "FLASH"}
                onClick={() => {
                  setStrongConfirmOpen(false);
                  setStrongConfirmText("");
                  void performFlash(true);
                }}
              >
                Confirm recovery flash
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TransportChoiceCard({
  title,
  status,
  description,
  selectionSummary,
  selectionDetail,
  selectionActions,
  busy = false,
  disabled = false,
  onMouseDownActivate,
  onClick,
}: {
  title: string;
  status: string;
  description: string;
  selectionSummary?: string;
  selectionDetail?: string;
  selectionActions?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onMouseDownActivate?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={[
        "relative flex h-full w-full min-w-0 flex-col rounded-[14px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3.5 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-70"
          : "cursor-pointer hover:bg-[var(--panel-2)]",
      ].join(" ")}
    >
      <button
        aria-label={`Choose ${title}`}
        className="absolute inset-0 z-0 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
        disabled={disabled}
        type="button"
        onMouseDown={
          onMouseDownActivate && !disabled
            ? (event) => {
                if (event.button !== 0) {
                  return;
                }
                event.preventDefault();
                onMouseDownActivate();
              }
            : undefined
        }
        onClick={
          onMouseDownActivate && !disabled
            ? (event) => {
                if (event.detail !== 0) {
                  event.preventDefault();
                  return;
                }
                onClick();
              }
            : disabled
              ? undefined
              : onClick
        }
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[14px] font-bold text-[var(--text)]">
            {title}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {busy ? (
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border border-current border-r-transparent"
              />
            ) : null}
            {status}
          </div>
        </div>
        <div className="mt-2.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
          {description}
        </div>
        {selectionSummary ? (
          <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
            <div
              className={[
                "flex min-w-0 gap-3",
                selectionActions ? "items-center" : "",
              ].join(" ")}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-[var(--text)]">
                  {selectionSummary}
                </div>
                {selectionDetail ? (
                  <div className="mt-1 text-[11px] font-semibold leading-5 text-[var(--muted)]">
                    {selectionDetail}
                  </div>
                ) : null}
              </div>
              {selectionActions ? (
                <div className="pointer-events-auto flex shrink-0 items-center gap-2">
                  {selectionActions}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FlashSummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <div className="font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </div>
      <div
        className={[
          "min-w-0 truncate font-bold text-[var(--text)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </>
  );
}

function TargetInfoCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={[
          "mt-1 min-w-0 break-words text-[12px] font-bold leading-6 text-[var(--text)]",
          mono ? "font-mono text-[11px] sm:text-[12px]" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
