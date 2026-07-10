import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { tryBootstrapDesktopAgent } from "../domain/desktopAgent";
import type { StoredDevice } from "../domain/devices";
import {
  type BundledFirmwareAsset,
  type BundledFirmwareManifest,
  DEMO_BUNDLED_FIRMWARE_MANIFEST,
  emptyBundledFirmwareManifest,
  loadBundledFirmwareManifest,
} from "../domain/firmwareBundle";
import {
  clearFlashTransportLock,
  clearGlobalFlashTransportLock,
  setFlashTransportLock,
  setGlobalFlashTransportLock,
} from "../domain/flashTransportLocks";
import {
  forgetGrantedWebSerialPort,
  getReusableGrantedWebSerialPort,
  type HardwareBoardInfo,
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
import { readLocalUsbInfo } from "../ui/dialogs/AddDeviceDialog.helpers";
import type { FirmwareFlashLogEntry } from "../ui/panels/FirmwareFlashLogPanel";
import {
  classifyProbe,
  DEMO_AUTHORIZED_WEB_USB_SELECTION,
  delayMs,
  describeWebSerialSelection,
  type FirmwareSourceMode,
  type FlashActivity,
  type FlashMode,
  type FlashModeReason,
  type FlashTransportMode,
  formatElapsedTimestamp,
  isWebSerialPickerCancelledError,
  normalizeFirmwareVersion,
  type PendingConnectionAction,
  PROBE_PICKER_TIMEOUT_MS,
  PROBE_READ_TIMEOUT_MS,
  PROBE_REFRESH_TIMEOUT_MS,
  type ProbeActivity,
  type ProbeActivityStage,
  type ProbeState,
  resolveExpectedIdentity,
  splitLogLines,
  type WebSerialInfoResult,
  type WebSerialProbeMode,
  type WebSerialProbeOptions,
  type WebSerialSelectionState,
} from "./firmwareFlashShared";

export function useFirmwareFlashConnection({
  currentDevice,
  currentLocalUsbPath,
  demoEnabled,
  demoProbeReading,
  demoAuthorizedWebUsb,
  webSerialSupported,
}: {
  currentDevice?: StoredDevice;
  currentLocalUsbPath?: string;
  demoEnabled: boolean;
  demoProbeReading: boolean;
  demoAuthorizedWebUsb: boolean;
  webSerialSupported: boolean;
}) {
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

  return {
    appendFlashLog,
    appendFlashLogLines,
    clearPseudoFlashProgress,
    currentDevice,
    expectedIdentity,
    flashActivity,
    flashBusy,
    flashError,
    flashLogSerialRef,
    flashLogs,
    flashMode,
    flashOperationStartedAtRef,
    localFile,
    localUsbDialogRef,
    localUsbPickerOpen,
    localUsbPorts,
    manifestError,
    manualAddress,
    openLocalUsbPicker,
    openWebUsbPicker,
    pendingConnectionAction,
    probe,
    probeActivity,
    probeClock,
    probing,
    readAuthorizedWebUsb,
    recoveryFlow,
    refreshProbeAfterFlash,
    releaseAuthorizedWebUsb,
    releaseChoices,
    selectedAsset,
    selectedLocalUsbPort,
    selectedLocalUsbPortInfo,
    selectedRelease,
    selectedReleaseTag,
    selectedWebSerialPortRef,
    selectedWebSerialSelection,
    setFlashActivity,
    setFlashBusy,
    setFlashError,
    setFlashLogs,
    setFlashMode,
    setFlashModeReason,
    setLocalFile,
    setLocalUsbPickerOpen,
    setManualAddress,
    setProbe,
    setSelectedReleaseTag,
    setSourceMode,
    setStrongConfirmOpen,
    setStrongConfirmText,
    setTransportMode,
    sourceMode,
    strongConfirmOpen,
    strongConfirmText,
    strongConfirmationRequired,
    targetNeedsStrongConfirmation,
    transportMode,
    webSerialReadyForManualRead,
    webUsbPickerOpen,
    pseudoFlashProgressTimerRef,
    selectLocalUsbPort,
  };
}

export type FirmwareFlashConnection = ReturnType<
  typeof useFirmwareFlashConnection
>;
