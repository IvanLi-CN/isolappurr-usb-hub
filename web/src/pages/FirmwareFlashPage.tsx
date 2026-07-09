import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  setFlashTransportLock,
} from "../domain/flashTransportLocks";
import {
  type FirmwareFlashProgress,
  flashBundledWithLocalUsb,
  flashWithLocalUsb,
  flashWithWebSerial,
  type HardwareBoardInfo,
  isWebSerialSupported,
  listLocalUsbSerialPorts,
  probeWebSerialBoard,
  readLocalUsbBoardInfo,
  refreshGrantedWebSerialPort,
  type SerialLikePort,
  type SerialPortInfo,
  WebSerialJsonlTransport,
} from "../domain/hardwareConsole";
import { getLocalUsbDeviceLink } from "../domain/localUsbLinks";
import { readLocalUsbInfo } from "../ui/dialogs/AddDeviceDialog.helpers";
import { FirmwareReleaseList } from "../ui/panels/FirmwareReleaseList";

type FlashTransportMode = "local_usb" | "web_serial";
type FirmwareSourceMode = "releases" | "local_file";
type FlashMode = "normal" | "recovery";
type ProbeKind = "idle" | "probing" | "recognized" | "non_project" | "unknown";
type WebSerialProbeMode = "picker" | "selected";

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

function composeFlashStatus(prefix: string, log: string): string {
  const trimmed = log.trim();
  return trimmed ? `${prefix}\n${trimmed}` : prefix;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

export function FirmwareFlashPage() {
  const navigate = useDemoNavigate();
  const { enabled: demoEnabled } = useDemoMode();
  const { getDevice } = useDevices();
  const [searchParams] = useSearchParams();
  const requestedDeviceId = searchParams.get("deviceId") ?? undefined;
  const currentDevice = requestedDeviceId
    ? getDevice(requestedDeviceId)
    : undefined;
  const currentLocalUsbPath = currentDevice
    ? (getLocalUsbDeviceLink(currentDevice.id) ??
      currentDevice.transports?.localUsbPortPath)
    : undefined;

  const [transportMode, setTransportMode] = useState<FlashTransportMode | null>(
    null,
  );
  const [sourceMode, setSourceMode] = useState<FirmwareSourceMode>("releases");
  const [flashMode, setFlashMode] = useState<FlashMode>("normal");
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
  const [localUsbPickerOpen, setLocalUsbPickerOpen] = useState(false);
  const [webUsbPickerOpen, setWebUsbPickerOpen] = useState(false);
  const [, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({
    kind: "idle",
    summary: "Target probe is waiting for a usable USB path.",
    detail:
      "Choose USB device or Web USB first so the page can probe the board.",
  });
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [manualAddress, setManualAddress] = useState("0x10000");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [flashProgress, setFlashProgress] =
    useState<FirmwareFlashProgress | null>(null);
  const [strongConfirmOpen, setStrongConfirmOpen] = useState(false);
  const [strongConfirmText, setStrongConfirmText] = useState("");
  const localUsbDialogRef = useRef<HTMLDialogElement>(null);
  const selectedWebSerialPortRef = useRef<SerialLikePort | null>(null);
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

  useLayoutEffect(() => {
    if (!currentDevice?.id) {
      return;
    }
    if (transportMode !== "local_usb") {
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
      setFlashMode("recovery");
    }
  }, [targetNeedsStrongConfirmation]);

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

  const expectedIdentity = resolveExpectedIdentity(currentDevice, probe);
  const strongConfirmationRequired =
    recoveryFlow && targetNeedsStrongConfirmation;
  const webSerialSupported = isWebSerialSupported();

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
          info = await readLocalUsbInfo(agent, port, () => undefined, 1);
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

  const probeWebSerial = async (mode: WebSerialProbeMode) => {
    if (demoEnabled) {
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
    const connectPort = async (port: SerialLikePort) => {
      const transport = new WebSerialJsonlTransport();
      await transport.connectToPort(port);
      const infoResult = await transport
        .request({
          id: Math.floor(Math.random() * 1_000_000_000),
          method: "info",
          timeoutMs: 1_200,
        })
        .then((value) => ({ ok: true as const, value }))
        .catch((err: unknown) => ({
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "Web Serial target did not expose project firmware metadata.",
        }));
      const selectedPort = await transport.takePortForExclusiveUse();
      const hardware = await probeWebSerialBoard(selectedPort).catch(
        () => undefined,
      );
      if (!infoResult.ok && !hardware) {
        throw new Error(infoResult.error);
      }
      const refreshedPort = await refreshGrantedWebSerialPort(
        selectedPort,
      ).catch(() => selectedPort);
      return {
        port: refreshedPort,
        probe: classifyProbe(
          infoResult.ok ? infoResult.value : null,
          infoResult.ok
            ? "Web Serial target did not expose project firmware metadata."
            : infoResult.error,
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
      );
      selectedWebSerialPortRef.current = candidate.port;
      setProbe(candidate.probe);
      return candidate.probe;
    }

    const transport = new WebSerialJsonlTransport();
    await transport.connectWithPicker();
    const port = await transport.takePortForExclusiveUse();
    const candidate = await connectPort(port);
    selectedWebSerialPortRef.current = candidate.port;
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
    selectedWebSerialPortRef.current = null;
    setTransportMode("local_usb");
    setFlashError(null);
    const ports = await loadLocalUsbPortChoices();
    setLocalUsbPorts(ports);
    setSelectedLocalUsbPort((current) => current || ports[0]?.path || "");
    setLocalUsbPickerOpen(true);
  };

  const openWebUsbPicker = async () => {
    if (currentDevice?.id) {
      setFlashTransportLock({
        deviceId: currentDevice.id,
        transport: "web_serial",
      });
    }
    setTransportMode("web_serial");
    setWebUsbPickerOpen(true);
    try {
      await runProbe("web_serial", undefined, "picker");
    } finally {
      setWebUsbPickerOpen(false);
    }
  };

  const selectLocalUsbPort = async (portPath: string) => {
    if (currentDevice?.id) {
      clearFlashTransportLock(currentDevice.id);
    }
    setSelectedLocalUsbPort(portPath);
    setLocalUsbPickerOpen(false);
    await runProbe("local_usb", portPath);
  };

  const runProbe = async (
    nextTransport: FlashTransportMode | null = transportMode,
    nextPortPath?: string,
    webSerialMode: WebSerialProbeMode = "picker",
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
      setProbe({
        kind: "probing",
        summary: "Reading target identity…",
        detail: "Waiting for the selected transport to respond.",
      });
      if (nextTransport === "local_usb") {
        await probeLocalUsb(nextPortPath);
      } else {
        await probeWebSerial(webSerialMode);
      }
    } catch (err) {
      setProbe({
        kind: "unknown",
        summary: "Target identity could not be confirmed.",
        detail: err instanceof Error ? err.message : "Probe failed.",
      });
    } finally {
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
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        setProbe({
          kind: "probing",
          summary: "Refreshing target identity…",
          detail: "Waiting for the board to reboot after flashing.",
        });
        const refreshed =
          nextTransport === "local_usb"
            ? await probeLocalUsb(selectedLocalUsbPort)
            : await probeWebSerial("selected");
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
    throw lastError instanceof Error
      ? lastError
      : new Error("Target identity refresh failed after flashing.");
  };

  const performFlash = async (confirmNonProjectFirmware: boolean) => {
    if (demoEnabled) {
      setFlashStatus(
        "Demo mode does not write hardware. This preview verifies the workbench UI only.",
      );
      setFlashError(null);
      setFlashProgress(null);
      return;
    }
    setFlashBusy(true);
    setFlashStatus(null);
    setFlashError(null);
    setFlashProgress(null);
    try {
      if (sourceMode === "releases") {
        if (!selectedRelease || !selectedAsset) {
          throw new Error("Choose a bundled firmware release first.");
        }
        if (transportMode === "local_usb") {
          const agent = await tryBootstrapDesktopAgent();
          if (!agent || !selectedLocalUsbPort) {
            throw new Error("Select a Local USB target first.");
          }
          const log = await flashBundledWithLocalUsb(
            agent,
            selectedLocalUsbPort,
            selectedRelease,
            selectedAsset,
            recoveryFlow,
            expectedIdentity,
            confirmNonProjectFirmware,
          );
          setFlashStatus(
            composeFlashStatus("Bundled release flash completed.", log),
          );
          await refreshProbeAfterFlash("local_usb").catch((err) => {
            setFlashStatus((current) =>
              composeFlashStatus(
                current ?? "Bundled release flash completed.",
                err instanceof Error
                  ? `Target refresh failed: ${err.message}`
                  : "Target refresh failed after flash.",
              ),
            );
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
        await flashWithWebSerial(
          refreshedPort,
          file,
          selectedAsset.flashAddress,
          setFlashProgress,
        );
        setFlashStatus("Web Serial firmware flash completed.");
        await refreshProbeAfterFlash("web_serial").catch((err) => {
          setFlashStatus((current) =>
            composeFlashStatus(
              current ?? "Web Serial firmware flash completed.",
              err instanceof Error
                ? `Target refresh failed: ${err.message}`
                : "Target refresh failed after flash.",
            ),
          );
        });
        return;
      }

      if (!localFile) {
        throw new Error("Select a local firmware file first.");
      }
      const address = Number.parseInt(manualAddress, 16);
      if (!Number.isFinite(address)) {
        throw new Error("Enter a valid hex flash address.");
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
        const log = await flashWithLocalUsb(
          agent,
          selectedLocalUsbPort,
          localFile,
          address,
          expectedIdentity ?? {},
        );
        setFlashStatus(
          composeFlashStatus("Local USB firmware flash completed.", log),
        );
        await refreshProbeAfterFlash("local_usb").catch((err) => {
          setFlashStatus((current) =>
            composeFlashStatus(
              current ?? "Local USB firmware flash completed.",
              err instanceof Error
                ? `Target refresh failed: ${err.message}`
                : "Target refresh failed after flash.",
            ),
          );
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
      await flashWithWebSerial(
        refreshedPort,
        localFile,
        address,
        setFlashProgress,
      );
      setFlashStatus("Web Serial firmware flash completed.");
      await refreshProbeAfterFlash("web_serial").catch((err) => {
        setFlashStatus((current) =>
          composeFlashStatus(
            current ?? "Web Serial firmware flash completed.",
            err instanceof Error
              ? `Target refresh failed: ${err.message}`
              : "Target refresh failed after flash.",
          ),
        );
      });
    } catch (err) {
      setFlashError(
        err instanceof Error ? err.message : "Firmware flash failed.",
      );
    } finally {
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

  const canFlash =
    !flashBusy &&
    !(
      !transportMode ||
      (sourceMode === "releases" && !selectedAsset) ||
      (sourceMode === "local_file" && !localFile) ||
      probe.kind === "idle" ||
      probe.kind === "probing" ||
      (!recoveryFlow && probe.kind !== "recognized") ||
      (transportMode === "web_serial" && selectedAsset?.fileKind === "elf") ||
      (transportMode === "web_serial" && !webSerialSupported) ||
      (sourceMode === "local_file" &&
        recoveryFlow &&
        transportMode === "local_usb")
    );
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
                  status={
                    transportMode === "local_usb" && selectedLocalUsbPort
                      ? "Selected"
                      : "Available"
                  }
                  description="Pick the exact ESP32-S3 serial path."
                  onClick={() => void openLocalUsbPicker()}
                />
              </div>
              <div>
                <TransportChoiceCard
                  title="Web USB"
                  status={
                    !webSerialSupported
                      ? "Unavailable"
                      : transportMode === "web_serial"
                        ? "Selected"
                        : "Available"
                  }
                  description="Open the browser picker immediately."
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
                  probeToneClass(probe.kind),
                ].join(" ")}
              >
                {probe.kind === "recognized"
                  ? "Confirmed"
                  : probe.kind === "non_project"
                    ? "Non-project"
                    : probe.kind === "probing"
                      ? "Probing"
                      : probe.kind === "unknown"
                        ? "Unconfirmed"
                        : "Waiting"}
              </div>
            </div>

            {targetRows.length > 0 ? (
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
              <div className="mt-3 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                <div className="text-[var(--text)]">{probe.summary}</div>
                <div className="mt-1">{probe.detail}</div>
              </div>
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
                  onChange={(event) =>
                    setLocalFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                <input
                  className="input input-sm h-12 w-full font-mono"
                  value={manualAddress}
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
                    targetNeedsStrongConfirmation && mode.key === "normal"
                  }
                  onClick={() => setFlashMode(mode.key as FlashMode)}
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

            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="text-[14px] font-bold">Flash log</div>
              <div className="mt-2 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                {transportMode === "local_usb"
                  ? "Use Local USB for bundled release flashing."
                  : "Use Web USB when browser serial access is preferred."}
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                {flashError
                  ? flashError
                  : transportMode === "web_serial" &&
                      selectedAsset?.fileKind === "elf"
                    ? "Selected recovery release is bundled as ELF. Use Local USB for desktop-assisted flashing."
                    : flashStatus
                      ? flashStatus
                      : flashProgress
                        ? `${flashProgress.message}${flashProgress.total ? ` ${Math.round(((flashProgress.written ?? 0) / flashProgress.total) * 100)}%` : ""}`
                        : "Flash progress appears here."}
              </div>
            </div>

            <button
              className={`${primaryButtonClass} mt-4 min-h-11 w-full`}
              type="button"
              disabled={!canFlash}
              onClick={() => void onFlash()}
            >
              {flashBusy
                ? "Flashing..."
                : recoveryFlow
                  ? "Flash recovery firmware"
                  : "Flash firmware"}
            </button>

            <button
              className={`${outlineButtonClass} mt-3 min-h-11 w-full`}
              type="button"
              onClick={() =>
                currentDevice
                  ? navigate(`/devices/${currentDevice.id}/info`)
                  : navigate("/")
              }
            >
              {currentDevice ? "Back to settings" : "Back to dashboard"}
            </button>
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
          className="fixed inset-0 z-40 bg-black/18"
          role="presentation"
          aria-hidden="true"
        >
          <div className="pointer-events-none absolute left-6 top-1/2 w-[360px] -translate-y-1/2 rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
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
  onMouseDownActivate,
  onClick,
}: {
  title: string;
  status: string;
  description: string;
  onMouseDownActivate?: () => void;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-full w-full min-w-0 flex-col rounded-[14px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--panel-2)]"
      type="button"
      onMouseDown={
        onMouseDownActivate
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
        onMouseDownActivate
          ? (event) => {
              if (event.detail !== 0) {
                event.preventDefault();
                return;
              }
              onClick();
            }
          : onClick
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[14px] font-bold text-[var(--text)]">{title}</div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
          {status}
        </div>
      </div>
      <div className="mt-2.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
        {description}
      </div>
    </button>
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
