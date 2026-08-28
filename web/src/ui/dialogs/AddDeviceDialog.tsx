import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useDemoMode } from "../../app/demo-mode";
import { useDemoNavigate } from "../../app/demo-navigation";
import { tryBootstrapDesktopAgent } from "../../domain/desktopAgent";
import { getDeviceInfo } from "../../domain/deviceApi";
import type {
  AddDeviceInput,
  AddDeviceValidationResult,
} from "../../domain/devices";
import { loadStoredDevices } from "../../domain/devices";
import type { DiscoveredDevice } from "../../domain/discovery";
import {
  createInitialDiscoverySnapshot,
  isDiscoveredDeviceAdded,
  mergeDiscoveredDevice,
  reduceDiscoverySnapshot,
} from "../../domain/discovery";
import {
  filterEsp32SerialPorts,
  isWebSerialSupported,
  listLocalUsbSerialPorts,
  type SerialPortInfo,
  WebSerialJsonlTransport,
} from "../../domain/hardwareConsole";
import {
  type IpScanSession,
  loadIpScanSession,
} from "../../domain/ipScanSession";
import { announceLocalUsbDeviceLink } from "../../domain/localUsbLinks";
import { announceNetworkDeviceLink } from "../../domain/networkLinks";
import { announceWebSerialDeviceLink } from "../../domain/webSerialLinks";
import { ActionButton } from "../actions/ActionButton";
import { DeviceDiscoveryPanel } from "../panels/DeviceDiscoveryPanel";
import {
  AddDeviceDialogFooter,
  AddDeviceDialogHeader,
  AddDeviceDialogMethodTabs,
  type AddDeviceMethod,
} from "./AddDeviceDialog.chrome";
import {
  hydrateInitialUsbLog,
  InlineAddError,
  isIsolaPurrDeviceInfo,
  parseOwnerFacingUsbDeviceId,
  parseUsbInfoEnvelope,
  readLocalUsbInfo,
  readWebSerialInfo,
  type UsbDeviceInfo,
  type UsbLogEntry,
  usbInfoMatchesHttpInfo,
} from "./AddDeviceDialog.helpers";
import { useIpScanController } from "./AddDeviceDialog.scan";

export type AddDeviceDialogProps = {
  open: boolean;
  initialMethod?: AddDeviceMethod;
  initialUsbLog?: Array<Omit<UsbLogEntry, "id">>;
  existingDeviceIds?: string[];
  existingDeviceBaseUrls?: string[];
  existingDeviceNamesById?: Record<string, string>;
  onClose: () => void;
  onCreate: (
    input: AddDeviceInput,
    options?: { navigate?: boolean },
  ) => Promise<AddDeviceValidationResult>;
  onUpsert: (input: AddDeviceInput) => Promise<AddDeviceValidationResult>;
};

export function AddDeviceDialog({
  open,
  initialMethod = "wifi",
  initialUsbLog,
  existingDeviceIds,
  existingDeviceBaseUrls,
  existingDeviceNamesById,
  onClose,
  onCreate,
  onUpsert,
}: AddDeviceDialogProps) {
  const navigate = useDemoNavigate();
  const { enabled: demoEnabled } = useDemoMode();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const devicesCountRef = useRef(0);
  const ipScanExpandedRef = useRef(false);
  const openRef = useRef(open);
  const methodRef = useRef<AddDeviceMethod>(initialMethod);
  const usbRunIdRef = useRef(0);
  const [method, setMethod] = useState<AddDeviceMethod>(initialMethod);
  const [addError, setAddError] = useState<string | null>(null);
  const [usbBusy, setUsbBusy] = useState(false);
  const [usbStatus, setUsbStatus] = useState<string | null>(null);
  const [usbLog, setUsbLog] = useState<UsbLogEntry[]>(() =>
    hydrateInitialUsbLog(initialUsbLog),
  );
  const [localUsbPorts, setLocalUsbPorts] = useState<SerialPortInfo[]>([]);
  const [selectedLocalUsbPort, setSelectedLocalUsbPort] = useState("");
  const [discoveryPanelKey, setDiscoveryPanelKey] = useState(0);
  const [manualName, setManualName] = useState("");
  const [manualBaseUrl, setManualBaseUrl] = useState("");
  const [manualId, setManualId] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [locallyAddedIds, setLocallyAddedIds] = useState<string[]>([]);
  const [locallyAddedBaseUrls, setLocallyAddedBaseUrls] = useState<string[]>(
    [],
  );
  const [, setLastIpScanSession] = useState<IpScanSession | null>(null);

  const ids = useMemo(() => existingDeviceIds ?? [], [existingDeviceIds]);
  const baseUrls = useMemo(
    () =>
      existingDeviceBaseUrls ??
      (open ? loadStoredDevices().map((d) => d.baseUrl) : []),
    [existingDeviceBaseUrls, open],
  );
  const discoveryIds = useMemo(
    () => [...new Set([...ids, ...locallyAddedIds])],
    [ids, locallyAddedIds],
  );
  const discoveryBaseUrls = useMemo(
    () => [...new Set([...baseUrls, ...locallyAddedBaseUrls])],
    [baseUrls, locallyAddedBaseUrls],
  );

  const [snapshot, dispatch] = useReducer(
    reduceDiscoverySnapshot,
    createInitialDiscoverySnapshot({
      status: "unavailable",
      autoExpandAfterMs: 30_000,
    }),
  );

  const addingDiscoveredRef = useRef(false);
  const addingDiscoveredSessionRef = useRef<number | null>(null);
  const snapshotRef = useRef(snapshot);
  const discoveryIdsRef = useRef(discoveryIds);
  const discoveryBaseUrlsRef = useRef(discoveryBaseUrls);
  const usbLogSeqRef = useRef(1);

  const appendUsbLog = (
    message: string,
    tone: UsbLogEntry["tone"] = "info",
  ) => {
    const entry = { id: usbLogSeqRef.current, message, tone };
    usbLogSeqRef.current += 1;
    setUsbLog((prev) => [...prev.slice(-7), entry]);
  };

  const setUsbStep = (message: string, tone: UsbLogEntry["tone"] = "info") => {
    setUsbStatus(message);
    appendUsbLog(message, tone);
  };

  const {
    agentRef,
    cancelActiveIpScan,
    onRefresh: refreshDiscovery,
    onStartScan: startIpScan,
  } = useIpScanController({
    open,
    demoEnabled,
    openRef,
    usbRunIdRef,
    dispatch,
    setLastIpScanSession,
  });

  const handleClose = useCallback(() => {
    void cancelActiveIpScan();
    usbRunIdRef.current += 1;
    onClose();
  }, [cancelActiveIpScan, onClose]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    methodRef.current = method;
  }, [method]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    discoveryIdsRef.current = discoveryIds;
    discoveryBaseUrlsRef.current = discoveryBaseUrls;
    devicesCountRef.current = snapshot.devices.length;
    ipScanExpandedRef.current = snapshot.ipScan?.expanded ?? false;
  }, [snapshot, discoveryIds, discoveryBaseUrls]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) {
      return;
    }
    if (open) {
      if (!el.open) {
        el.showModal();
      }
      setAddError(null);
      setUsbBusy(false);
      setUsbStatus(null);
      setUsbLog(hydrateInitialUsbLog(initialUsbLog));
      setLocalUsbPorts([]);
      setSelectedLocalUsbPort("");
      setManualName("");
      setManualBaseUrl("");
      setManualId("");
      setManualBusy(false);
      setLocallyAddedIds([]);
      setLocallyAddedBaseUrls([]);
      setLastIpScanSession(null);
      methodRef.current = initialMethod;
      usbRunIdRef.current += 1;
      setMethod(initialMethod);
      setDiscoveryPanelKey((v) => v + 1);
      dispatch({ type: "reset", status: "unavailable" });
      const cached = loadIpScanSession(demoEnabled);
      if (cached) {
        setLastIpScanSession(cached);
        dispatch({
          type: "restore_scan",
          cidr: cached.cidr,
          devices: cached.devices,
        });
        dispatch({
          type: "toggle_ip_scan",
          expanded: true,
          expandedBy: "auto",
        });
      }
      return;
    }

    void cancelActiveIpScan();
    usbRunIdRef.current += 1;
    setLastIpScanSession(null);
    agentRef.current = null;
    if (el.open) {
      el.close();
    }
  }, [
    agentRef,
    cancelActiveIpScan,
    demoEnabled,
    initialMethod,
    initialUsbLog,
    open,
  ]);

  useEffect(() => {
    if (!open || method !== "local_usb") {
      return;
    }
    let cancelled = false;

    const loadLocalUsbPorts = async () => {
      setAddError(null);
      setUsbStatus("Looking for Local USB ports...");
      try {
        const agent = agentRef.current ?? (await tryBootstrapDesktopAgent());
        agentRef.current = agent;
        if (cancelled || methodRef.current !== "local_usb") {
          return;
        }
        if (!agent) {
          setLocalUsbPorts([]);
          setSelectedLocalUsbPort("");
          setAddError("Local USB service is not running.");
          return;
        }
        const ports = filterEsp32SerialPorts(
          await listLocalUsbSerialPorts(agent),
        );
        if (cancelled || methodRef.current !== "local_usb") {
          return;
        }
        setLocalUsbPorts(ports);
        setSelectedLocalUsbPort((current) =>
          ports.some((port) => port.path === current) ? current : "",
        );
        if (ports.length === 0) {
          setAddError("No ESP32 USB serial ports found.");
          setUsbStatus(null);
          return;
        }
        setUsbStatus(
          ports.length === 1
            ? "Local USB device ready. Click it to connect."
            : "Choose a Local USB device to connect.",
        );
      } catch (err) {
        if (!cancelled && methodRef.current === "local_usb") {
          setLocalUsbPorts([]);
          setSelectedLocalUsbPort("");
          setAddError(
            err instanceof Error ? err.message : "Local USB port list failed.",
          );
        }
      }
    };

    void loadLocalUsbPorts();
    return () => {
      cancelled = true;
    };
  }, [agentRef, open, method]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const ipScan = snapshot.ipScan;
    if (!ipScan || ipScan.expanded) {
      return;
    }
    if (snapshot.mode !== "service" || snapshot.status !== "scanning") {
      return;
    }
    if (!ipScan.autoExpandAfterMs) {
      return;
    }

    const expectedCount = devicesCountRef.current;
    const timer = window.setTimeout(() => {
      if (devicesCountRef.current !== expectedCount) {
        return;
      }
      if (ipScanExpandedRef.current) {
        return;
      }
      dispatch({
        type: "toggle_ip_scan",
        expanded: true,
        expandedBy: "auto",
      });
      dispatch({
        type: "set_error",
        error:
          "No devices found yet — try IP scan (advanced) with a CIDR range.",
      });
    }, ipScan.autoExpandAfterMs);
    return () => window.clearTimeout(timer);
  }, [open, snapshot.ipScan, snapshot.mode, snapshot.status]);

  const saveManualDevice = async () => {
    const sessionGeneration = usbRunIdRef.current;
    setManualBusy(true);
    setAddError(null);
    try {
      const input: AddDeviceInput = {
        name: manualName,
        baseUrl: manualBaseUrl,
        id: manualId,
      };
      const saved = await onCreate(input, { navigate: false });
      if (!openRef.current || usbRunIdRef.current !== sessionGeneration) {
        return;
      }
      if (!saved.ok) {
        setAddError(
          saved.errors.baseUrl ??
            saved.errors.id ??
            saved.errors.name ??
            "Could not add this hub.",
        );
        return;
      }
      setManualName("");
      setManualBaseUrl("");
      setManualId("");
      setAddError(null);
      handleClose();
      navigate(`/devices/${saved.device.id}`);
    } finally {
      if (openRef.current && usbRunIdRef.current === sessionGeneration) {
        setManualBusy(false);
      }
    }
  };

  const addDiscoveredDevice = async (device: DiscoveredDevice) => {
    const sessionGeneration = usbRunIdRef.current;
    if (
      addingDiscoveredRef.current &&
      addingDiscoveredSessionRef.current === sessionGeneration
    ) {
      return;
    }
    addingDiscoveredRef.current = true;
    addingDiscoveredSessionRef.current = sessionGeneration;
    try {
      if (!device.baseUrl) {
        setAddError("Discovered hub did not include a network URL.");
        return;
      }
      const input: AddDeviceInput = {
        name:
          device.hostname ??
          device.fqdn ??
          device.device_id ??
          "IsolaPurr USB Hub",
        baseUrl: device.baseUrl,
        id: device.device_id,
      };
      const saved = await onCreate(input, { navigate: false });
      if (!openRef.current || usbRunIdRef.current !== sessionGeneration) {
        return;
      }
      if (!saved.ok) {
        setAddError(
          saved.errors.baseUrl ??
            saved.errors.id ??
            saved.errors.name ??
            "Could not add this hub.",
        );
        return;
      }
      setAddError(null);
      const nextIds = device.device_id
        ? [...discoveryIdsRef.current, device.device_id]
        : discoveryIdsRef.current;
      const nextBaseUrls = [...discoveryBaseUrlsRef.current, device.baseUrl];
      setLocallyAddedIds((current) =>
        device.device_id && !current.includes(device.device_id)
          ? [...current, device.device_id]
          : current,
      );
      setLocallyAddedBaseUrls((current) =>
        current.includes(device.baseUrl)
          ? current
          : [...current, device.baseUrl],
      );

      let merged: DiscoveredDevice[] = [];
      const currentSnapshot = snapshotRef.current;
      const visibleCandidates = [
        ...currentSnapshot.devices,
        ...(currentSnapshot.scan?.devices ?? []),
      ];
      for (const candidate of visibleCandidates) {
        merged = mergeDiscoveredDevice(merged, candidate);
      }
      const hasAnotherAddable = merged.some(
        (candidate) =>
          !isDiscoveredDeviceAdded(candidate, nextIds, nextBaseUrls),
      );
      if (hasAnotherAddable) {
        return;
      }
      handleClose();
      navigate(`/devices/${saved.device.id}`);
    } finally {
      if (addingDiscoveredSessionRef.current === sessionGeneration) {
        addingDiscoveredRef.current = false;
        addingDiscoveredSessionRef.current = null;
      }
    }
  };

  const resolveReachableUsbBaseUrl = async (
    device: UsbDeviceInfo,
    id: string,
    hostname: string,
    run?: { id: number; method: AddDeviceMethod },
  ): Promise<string> => {
    const mdnsBaseUrl = `http://${device.fqdn?.trim() || `${hostname}.local`}`;
    const ipv4 = device.wifi?.ipv4?.trim();
    if (!ipv4) {
      setUsbStep(
        "USB info did not report a Wi-Fi IPv4 address. Saving the mDNS URL instead.",
        "warning",
      );
      return mdnsBaseUrl;
    }

    const wifiBaseUrl = `http://${ipv4}`;
    setUsbStep(`Checking Wi-Fi reachability at ${wifiBaseUrl}...`);
    const res = await getDeviceInfo(wifiBaseUrl);
    if (run && !isActiveUsbRun(run.id, run.method)) {
      return mdnsBaseUrl;
    }
    if (!res.ok) {
      setUsbStep(
        `Wi-Fi reported ${ipv4}, but verified HTTP is not ready yet: ${res.error.message}`,
        "warning",
      );
      return mdnsBaseUrl;
    }
    if (!usbInfoMatchesHttpInfo(id, res.value)) {
      setUsbStep(
        "Wi-Fi HTTP responded, but identity did not match the USB device.",
        "warning",
      );
      return mdnsBaseUrl;
    }

    setUsbStep("Wi-Fi HTTP link verified and will be saved.", "success");
    announceNetworkDeviceLink({ deviceId: id, baseUrl: wifiBaseUrl });
    return wifiBaseUrl;
  };

  const addUsbDevice = async (
    envelope: unknown,
    fallback?: {
      serialNumber?: string | null;
      portPath?: string;
      webSerialTransport?: WebSerialJsonlTransport;
    },
    run?: { id: number; method: AddDeviceMethod },
  ): Promise<boolean> => {
    if (run && !isActiveUsbRun(run.id, run.method)) {
      return false;
    }

    const parsed = parseUsbInfoEnvelope(envelope);
    if (!parsed.ok) {
      setAddError(parsed.error);
      return false;
    }

    const device = parsed.device;
    const parsedDeviceId = parseOwnerFacingUsbDeviceId(device.device_id);
    if (!parsedDeviceId.ok) {
      setAddError(parsedDeviceId.error);
      return false;
    }
    const id = parsedDeviceId.deviceId;

    const hostname = device.hostname?.trim() || `isolapurr-usb-hub-${id}`;
    const baseUrl = await resolveReachableUsbBaseUrl(device, id, hostname, run);
    if (run && !isActiveUsbRun(run.id, run.method)) {
      return false;
    }

    setUsbStep("Saving hub profile...");
    const existingName = existingDeviceNamesById?.[id]?.trim();
    const input = {
      id,
      name: existingName || hostname,
      baseUrl,
      transports: {
        httpBaseUrl: baseUrl,
        localUsbPortPath: fallback?.portPath,
      },
    };
    const saved = ids.includes(id)
      ? await onUpsert(input)
      : await onCreate(input, { navigate: false });
    if (run && !isActiveUsbRun(run.id, run.method)) {
      return false;
    }
    if (!saved.ok) {
      if (saved.errors.id === "ID already exists") {
        if (fallback?.portPath) {
          announceLocalUsbDeviceLink({
            deviceId: id,
            portPath: fallback.portPath,
          });
        }
        if (fallback?.webSerialTransport) {
          announceWebSerialDeviceLink({
            deviceId: id,
            transport: fallback.webSerialTransport,
          });
        }
        const updated = await onUpsert(input);
        if (run && !isActiveUsbRun(run.id, run.method)) {
          return false;
        }
        if (updated.ok) {
          setUsbStep(
            "Existing hub updated with the latest connection link.",
            "success",
          );
          setAddError(null);
          handleClose();
          navigate(`/devices/${id}`);
          return true;
        }
      }
      setAddError(
        saved.errors.id ??
          saved.errors.baseUrl ??
          saved.errors.name ??
          "Could not add this hub.",
      );
      return false;
    }
    setUsbStep("Hub saved.", "success");
    if (fallback?.portPath) {
      announceLocalUsbDeviceLink({ deviceId: id, portPath: fallback.portPath });
    }
    if (fallback?.webSerialTransport) {
      announceWebSerialDeviceLink({
        deviceId: id,
        transport: fallback.webSerialTransport,
      });
    }
    setAddError(null);
    handleClose();
    navigate(`/devices/${id}`);
    return true;
  };

  const connectByLocalUsb = async (portPath?: string) => {
    const runId = startUsbRun("local_usb");
    setUsbBusy(true);
    setAddError(null);
    setUsbLog([]);
    setUsbStep("Preparing Local USB connection...");
    try {
      const agent = agentRef.current ?? (await tryBootstrapDesktopAgent());
      agentRef.current = agent;
      if (!isActiveUsbRun(runId, "local_usb")) {
        return;
      }
      if (!agent) {
        setAddError("Local USB service is not running.");
        return;
      }
      const ports =
        localUsbPorts.length > 0
          ? localUsbPorts
          : filterEsp32SerialPorts(await listLocalUsbSerialPorts(agent));
      setLocalUsbPorts(ports);
      if (!isActiveUsbRun(runId, "local_usb")) {
        return;
      }
      if (ports.length === 0) {
        setAddError("No ESP32 USB serial ports found.");
        return;
      }

      const selectedPortPath = portPath ?? selectedLocalUsbPort;
      if (selectedPortPath) {
        setSelectedLocalUsbPort(selectedPortPath);
        const port = ports.find((p) => p.path === selectedPortPath);
        if (!port) {
          setUsbStep("Choose the IsolaPurr ESP32 USB device to connect.");
          return;
        }
        setUsbStep(`Opening Local USB port ${port.path}...`);
        const response = await readLocalUsbInfo(agent, port, appendUsbLog);
        await addUsbDevice(
          response,
          { serialNumber: port.serialNumber, portPath: port.path },
          { id: runId, method: "local_usb" },
        );
        return;
      }

      setUsbStep("Identifying IsolaPurr USB hub...");
      for (const port of ports) {
        try {
          setUsbStep(`Trying Local USB port ${port.path}...`);
          const response = await readLocalUsbInfo(agent, port, appendUsbLog);
          if (!isActiveUsbRun(runId, "local_usb")) {
            return;
          }
          const parsed = parseUsbInfoEnvelope(response);
          if (!parsed.ok || !isIsolaPurrDeviceInfo(parsed.device)) {
            continue;
          }
          setSelectedLocalUsbPort(port.path);
          await addUsbDevice(
            response,
            { serialNumber: port.serialNumber, portPath: port.path },
            { id: runId, method: "local_usb" },
          );
          return;
        } catch {
          // Keep probing other ESP32 serial ports.
        }
      }

      if (ports.length === 1) {
        setAddError("The ESP32 USB port did not respond as IsolaPurr.");
        appendUsbLog(
          "Local USB info request did not identify IsolaPurr.",
          "error",
        );
        return;
      }
      setUsbStep("Choose the IsolaPurr ESP32 USB device to connect.");
    } catch (err) {
      if (isActiveUsbRun(runId, "local_usb")) {
        const message =
          err instanceof Error ? err.message : "Local USB failed.";
        appendUsbLog(message, "error");
        setAddError(message);
      }
    } finally {
      if (isActiveUsbRun(runId, "local_usb")) {
        setUsbBusy(false);
      }
    }
  };

  const connectByWebSerial = async () => {
    const runId = startUsbRun("web_serial");
    setUsbBusy(true);
    setAddError(null);
    setUsbLog([]);
    setUsbStep("Requesting browser serial access...");
    const transport = new WebSerialJsonlTransport();
    let handedOff = false;
    try {
      await transport.connectWithPicker();
      if (!isActiveUsbRun(runId, "web_serial")) {
        return;
      }
      setUsbStep("Browser serial port opened. Reading connected hub...");
      const response = await readWebSerialInfo(transport, appendUsbLog);
      handedOff = await addUsbDevice(
        response,
        { webSerialTransport: transport },
        {
          id: runId,
          method: "web_serial",
        },
      );
    } catch (err) {
      if (isActiveUsbRun(runId, "web_serial")) {
        const message =
          err instanceof Error ? err.message : "Web Serial failed.";
        appendUsbLog(message, "error");
        setAddError(message);
      }
    } finally {
      if (!handedOff) {
        await transport.disconnect().catch(() => undefined);
      }
      if (isActiveUsbRun(runId, "web_serial")) {
        setUsbBusy(false);
      }
    }
  };

  const selectMethod = (nextMethod: AddDeviceMethod) => {
    if (nextMethod === methodRef.current) {
      return;
    }
    void cancelActiveIpScan();
    usbRunIdRef.current += 1;
    methodRef.current = nextMethod;
    setMethod(nextMethod);
    setAddError(null);
    setUsbStatus(null);
    setUsbLog([]);
    setUsbBusy(false);
  };

  const startUsbRun = (runMethod: AddDeviceMethod) => {
    const runId = usbRunIdRef.current + 1;
    usbRunIdRef.current = runId;
    methodRef.current = runMethod;
    return runId;
  };

  const isActiveUsbRun = (runId: number, runMethod: AddDeviceMethod) =>
    openRef.current &&
    usbRunIdRef.current === runId &&
    methodRef.current === runMethod;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Add device"
      data-testid="add-device-dialog"
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          handleClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== dialogRef.current) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClose();
        }
      }}
    >
      <div className="modal-box iso-modal flex max-h-[calc(100vh-32px)] w-[1040px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--panel)] px-8 pb-7 pt-6">
        <AddDeviceDialogHeader
          onOpenFlash={() => {
            handleClose();
            navigate("/flash/");
          }}
        />
        <AddDeviceDialogMethodTabs
          method={method}
          demoEnabled={demoEnabled}
          onSelect={selectMethod}
        />

        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {method === "wifi" ? (
              <>
                <div className="grid min-h-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <DeviceDiscoveryPanel
                    key={discoveryPanelKey}
                    snapshot={snapshot}
                    existingDeviceIds={discoveryIds}
                    existingDeviceBaseUrls={discoveryBaseUrls}
                    onRefresh={refreshDiscovery}
                    onToggleIpScan={(expanded) =>
                      dispatch({
                        type: "toggle_ip_scan",
                        expanded,
                        expandedBy: "user",
                      })
                    }
                    onStartScan={startIpScan}
                    onCancelScan={cancelActiveIpScan}
                    onSelect={(device: DiscoveredDevice) => {
                      void addDiscoveredDevice(device);
                    }}
                  />
                  <div className="rounded-[16px] border border-[var(--border)] bg-[var(--panel-2)] p-5">
                    <div className="text-[16px] font-bold">Manual add</div>
                    <div className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]">
                      {demoEnabled
                        ? "Enter a verified LAN URL or a demo URL. Demo mode creates a session-only device profile."
                        : "Enter a verified LAN URL and the device_id reported by the hub."}
                    </div>
                    <div className="mt-5 grid gap-4">
                      <label className="grid gap-2">
                        <span className="text-[12px] font-bold text-[var(--muted)]">
                          Name
                        </span>
                        <input
                          className="h-[40px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[13px] font-medium text-[var(--text)] outline-none"
                          value={manualName}
                          onChange={(event) =>
                            setManualName(event.target.value)
                          }
                          placeholder="Bench Hub Gamma"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-[12px] font-bold text-[var(--muted)]">
                          Base URL
                        </span>
                        <input
                          className="h-[40px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[13px] font-medium text-[var(--text)] outline-none"
                          value={manualBaseUrl}
                          onChange={(event) =>
                            setManualBaseUrl(event.target.value)
                          }
                          placeholder="http://192.168.31.60"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-[12px] font-bold text-[var(--muted)]">
                          device_id
                        </span>
                        <input
                          className="h-[40px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 font-mono text-[13px] font-medium text-[var(--text)] outline-none"
                          value={manualId}
                          onChange={(event) => setManualId(event.target.value)}
                          placeholder={
                            demoEnabled
                              ? "optional in demo mode"
                              : "aabbcc001122"
                          }
                        />
                      </label>
                      <ActionButton
                        fullWidth
                        loading={manualBusy}
                        tone="primary"
                        onClick={() => void saveManualDevice()}
                      >
                        Add manually
                      </ActionButton>
                    </div>
                  </div>
                </div>
                {addError ? <InlineAddError message={addError} /> : null}
              </>
            ) : (
              <div className="flex min-h-[360px] flex-col justify-between rounded-[16px] border border-[var(--border)] bg-[var(--panel-2)] p-5">
                <div>
                  <div className="text-[16px] font-bold">
                    {method === "web_serial"
                      ? "Add by Web Serial"
                      : "Add by Local USB"}
                  </div>
                  <div className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]">
                    {method === "web_serial"
                      ? "Select the hub in the browser serial picker. The app reads device info over USB and adds it here."
                      : "Use the local desktop service to read the connected hub over USB and add it here."}
                  </div>
                  {demoEnabled ? (
                    <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--warning)]">
                      Demo mode blocks real USB transports. Use Wi-Fi / LAN
                      discovery or Manual add instead.
                    </div>
                  ) : null}
                  {method === "web_serial" && !isWebSerialSupported() ? (
                    <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--warning)]">
                      This browser does not expose Web Serial. Use Chrome/Edge
                      or Local USB.
                    </div>
                  ) : null}
                  {method === "local_usb" && localUsbPorts.length > 0 ? (
                    <div className="mt-5">
                      <div className="text-[12px] font-bold text-[var(--muted)]">
                        Local USB devices
                      </div>
                      <div className="mt-2 grid gap-2">
                        {localUsbPorts.map((port) => {
                          const active = selectedLocalUsbPort === port.path;
                          return (
                            <button
                              key={port.path}
                              className={[
                                "flex min-h-[58px] w-full items-center justify-between gap-4 rounded-[12px] border px-4 py-3 text-left",
                                active
                                  ? "border-[var(--primary)] bg-[var(--panel)]"
                                  : "border-[var(--border)] bg-[var(--panel)]",
                                usbBusy
                                  ? "cursor-not-allowed opacity-70"
                                  : "hover:border-[var(--primary)]",
                              ].join(" ")}
                              type="button"
                              disabled={usbBusy}
                              onClick={() => void connectByLocalUsb(port.path)}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-bold text-[var(--text)]">
                                  {port.label}
                                </span>
                                <span className="mt-1 block truncate font-mono text-[12px] font-semibold text-[var(--muted)]">
                                  {port.path}
                                </span>
                              </span>
                              <span className="shrink-0 text-[12px] font-bold text-[var(--muted)]">
                                {usbBusy && active
                                  ? "Connecting..."
                                  : "Connect"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {usbStatus ? (
                    <div className="mt-4 text-[12px] font-semibold text-[var(--muted)]">
                      {usbStatus}
                    </div>
                  ) : null}
                  {usbLog.length > 0 ? (
                    <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
                      <div className="text-[12px] font-bold text-[var(--muted)]">
                        Connection log
                      </div>
                      <div className="mt-2 grid gap-1.5">
                        {usbLog.map((entry) => (
                          <div
                            key={entry.id}
                            className={[
                              "flex min-w-0 items-start gap-2 text-[12px] font-semibold leading-5",
                              entry.tone === "success"
                                ? "text-[var(--badge-success-text)]"
                                : entry.tone === "warning"
                                  ? "text-[var(--warning)]"
                                  : entry.tone === "error"
                                    ? "text-[var(--error)]"
                                    : "text-[var(--muted)]",
                            ].join(" ")}
                          >
                            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                            <span className="min-w-0 break-words">
                              {entry.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {addError ? <InlineAddError message={addError} /> : null}
                </div>

                {method === "web_serial" ? (
                  <div className="mt-8 grid gap-3">
                    <ActionButton
                      fullWidth
                      loading={usbBusy}
                      tone="primary"
                      disabled={demoEnabled || !isWebSerialSupported()}
                      onClick={() => void connectByWebSerial()}
                    >
                      Connect and add
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <AddDeviceDialogFooter onCancel={handleClose} />
      </div>
    </dialog>
  );
}
