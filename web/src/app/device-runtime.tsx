import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../domain/desktopAgent";
import {
  clearWifiConfig,
  type DeviceApiError,
  type DeviceInfoResponse,
  getDeviceInfo,
  getPorts,
  getWifiConfig,
  type RebootResponse,
  type Result,
  rebootDevice,
  replugPort,
  setPortPower,
  setWifiConfig,
  type WifiConfigInput,
  type WifiConfigResponse,
  type WifiMutationResponse,
} from "../domain/deviceApi";
import {
  nextJsonlRequestId,
  sendLocalUsbJsonlRequest,
} from "../domain/hardwareConsole";
import {
  getLocalUsbDeviceLink,
  subscribeLocalUsbDeviceLinks,
} from "../domain/localUsbLinks";
import type { HubState, Port, PortId, PortsResponse } from "../domain/ports";
import {
  forgetWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
  subscribeWebSerialDeviceLinks,
} from "../domain/webSerialLinks";
import { useToast } from "../ui/toast/ToastProvider";
import { useDevices } from "./devices-store";

export type ConnectionState = "online" | "offline" | "unknown";
export type DeviceTransport = "http" | "web_serial" | "local_usb";

type ChannelRuntime = {
  lastOkAt: number | null;
  lastError: DeviceApiError | null;
};

type DeviceRuntime = {
  lastOkAt: number | null;
  lastError: DeviceApiError | null;
  transport: DeviceTransport | null;
  channels: Record<DeviceTransport, ChannelRuntime>;
  hub: HubState | null;
  ports: Record<PortId, Port> | null;
  pending: Record<PortId, boolean>;
};

type DeviceRuntimeContextValue = {
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
  connectionState: (deviceId: string) => ConnectionState;
  lastOkAt: (deviceId: string) => number | null;
  lastErrorLabel: (deviceId: string) => string | null;
  transport: (deviceId: string) => DeviceTransport | null;
  wifiManagementTransport: (deviceId: string) => DeviceTransport | null;
  channelState: (
    deviceId: string,
    transport: DeviceTransport,
  ) => ConnectionState;
  hub: (deviceId: string) => HubState | null;
  port: (deviceId: string, portId: PortId) => Port | null;
  pending: (deviceId: string, portId: PortId) => boolean;
  refreshDevice: (deviceId: string) => Promise<void>;
  deviceInfo: (deviceId: string) => Promise<Result<DeviceInfoResponse>>;
  wifiConfig: (deviceId: string) => Promise<Result<WifiConfigResponse>>;
  saveWifiConfig: (
    deviceId: string,
    input: WifiConfigInput,
  ) => Promise<Result<WifiMutationResponse>>;
  clearWifiConfig: (deviceId: string) => Promise<Result<WifiMutationResponse>>;
  rebootDevice: (deviceId: string) => Promise<Result<RebootResponse>>;
  setPower: (
    deviceId: string,
    portId: PortId,
    enabled: boolean,
  ) => Promise<void>;
  replug: (deviceId: string, portId: PortId) => Promise<void>;
};

const DeviceRuntimeContext = createContext<DeviceRuntimeContextValue | null>(
  null,
);

const OFFLINE_THRESHOLD_MS = 10_000;
const TRANSPORTS: DeviceTransport[] = ["http", "web_serial", "local_usb"];

type JsonlEnvelope<T> = {
  id?: number | string | null;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string; retryable: boolean };
};

function shortApiError(err: DeviceApiError): string {
  if (err.kind === "offline") {
    return "Offline: device unreachable";
  }
  if (err.kind === "preflight_blocked") {
    return "Blocked: CORS/PNA preflight";
  }
  if (err.kind === "invalid_response") {
    return "Invalid response";
  }
  if (err.kind === "busy") {
    return "Busy";
  }
  return `API error: ${err.code}`;
}

export function DeviceRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { devices } = useDevices();
  const { pushToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [runtimeById, setRuntimeById] = useState<Record<string, DeviceRuntime>>(
    {},
  );
  const inflight = useRef<Set<string>>(new Set());
  const localUsbAgent = useRef<DesktopAgent | null>(null);
  const localUsbPortByDevice = useRef<Record<string, string>>({});
  const localUsbRequestQueues = useRef<Record<string, Promise<void>>>({});
  const preferredTransportByDevice = useRef<Record<string, DeviceTransport>>(
    {},
  );

  useEffect(() => {
    setRuntimeById((prev) => {
      const next: Record<string, DeviceRuntime> = { ...prev };
      const alive = new Set(devices.map((d) => d.id));
      for (const id of Object.keys(next)) {
        if (!alive.has(id)) {
          delete next[id];
        }
      }
      for (const d of devices) {
        if (!next[d.id]) {
          next[d.id] = {
            lastOkAt: null,
            lastError: null,
            transport: null,
            channels: createEmptyChannels(),
            hub: null,
            ports: null,
            pending: { port_a: false, port_c: false },
          };
        }
      }
      return next;
    });
  }, [devices]);

  const getLocalUsbAgent =
    useCallback(async (): Promise<DesktopAgent | null> => {
      if (localUsbAgent.current) {
        return localUsbAgent.current;
      }
      const agent = await tryBootstrapDesktopAgent();
      localUsbAgent.current = agent;
      return agent;
    }, []);

  const findLocalUsbPort = useCallback(
    async (deviceId: string): Promise<string | null> => {
      const cached = localUsbPortByDevice.current[deviceId];
      if (cached) {
        return cached;
      }
      const linked = getLocalUsbDeviceLink(deviceId);
      if (linked) {
        localUsbPortByDevice.current[deviceId] = linked;
        return linked;
      }
      return null;
    },
    [],
  );

  const requestLocalUsb = useCallback(
    async <T,>(
      deviceId: string,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Result<T>> => {
      const agent = await getLocalUsbAgent();
      if (!agent) {
        return {
          ok: false,
          error: { kind: "offline", message: "Local USB service unavailable" },
        };
      }
      const portPath = await findLocalUsbPort(deviceId);
      if (!portPath) {
        return {
          ok: false,
          error: { kind: "offline", message: "Local USB device not found" },
        };
      }
      const previous =
        localUsbRequestQueues.current[deviceId] ?? Promise.resolve();
      let releaseQueue: () => void = () => undefined;
      const current = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      const queued = previous.catch(() => undefined).then(() => current);
      localUsbRequestQueues.current[deviceId] = queued;
      await previous.catch(() => undefined);
      try {
        const response = await sendLocalUsbJsonlRequest(agent, portPath, {
          id: nextJsonlRequestId(),
          method,
          params,
        });
        const envelope = response as JsonlEnvelope<T>;
        if (envelope?.ok && envelope.result !== undefined) {
          return { ok: true, value: envelope.result };
        }
        return {
          ok: false,
          error: {
            kind: "api_error",
            status: 500,
            code: envelope?.error?.code ?? "local_usb_error",
            message: envelope?.error?.message ?? "Local USB request failed",
            retryable: envelope?.error?.retryable ?? false,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Local USB request failed";
        if (!message.includes("serial port is busy")) {
          localUsbAgent.current = null;
          delete localUsbPortByDevice.current[deviceId];
        }
        return {
          ok: false,
          error: {
            kind: "offline",
            message,
          },
        };
      } finally {
        releaseQueue();
        if (localUsbRequestQueues.current[deviceId] === queued) {
          delete localUsbRequestQueues.current[deviceId];
        }
      }
    },
    [findLocalUsbPort, getLocalUsbAgent],
  );

  const requestWebSerial = useCallback(
    async <T,>(
      deviceId: string,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Result<T>> => {
      const transport = getWebSerialDeviceTransport(deviceId);
      if (!transport) {
        return {
          ok: false,
          error: { kind: "offline", message: "Web Serial not connected" },
        };
      }
      try {
        const response = await transport.request({
          id: nextJsonlRequestId(),
          method,
          params,
        });
        const envelope = response as JsonlEnvelope<T>;
        if (envelope?.ok && envelope.result !== undefined) {
          return { ok: true, value: envelope.result };
        }
        return {
          ok: false,
          error: {
            kind: "api_error",
            status: 500,
            code: envelope?.error?.code ?? "web_serial_error",
            message: envelope?.error?.message ?? "Web Serial request failed",
            retryable: envelope?.error?.retryable ?? false,
          },
        };
      } catch (err) {
        forgetWebSerialDeviceTransport(deviceId);
        return {
          ok: false,
          error: {
            kind: "offline",
            message:
              err instanceof Error ? err.message : "Web Serial request failed",
          },
        };
      }
    },
    [],
  );

  const requestTransport = useCallback(
    async <T,>(
      deviceId: string,
      baseUrl: string,
      transport: DeviceTransport,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Result<T>> => {
      if (transport === "http") {
        if (method === "ports.get") {
          return getPorts(baseUrl) as Promise<Result<T>>;
        }
        if (method === "info") {
          return getDeviceInfo(baseUrl) as Promise<Result<T>>;
        }
        if (method === "wifi.get") {
          return getWifiConfig(baseUrl) as Promise<Result<T>>;
        }
        if (method === "wifi.set") {
          return setWifiConfig(baseUrl, {
            ssid: String(params?.ssid ?? ""),
            psk: String(params?.psk ?? ""),
          }) as Promise<Result<T>>;
        }
        if (method === "wifi.clear") {
          return clearWifiConfig(baseUrl) as Promise<Result<T>>;
        }
        if (method === "reboot") {
          return rebootDevice(baseUrl) as Promise<Result<T>>;
        }
        if (method === "port.power_set") {
          return setPortPower(
            baseUrl,
            params?.port as PortId,
            Boolean(params?.enabled),
          ) as Promise<Result<T>>;
        }
        if (method === "port.replug") {
          return replugPort(baseUrl, params?.port as PortId) as Promise<
            Result<T>
          >;
        }
      }
      if (transport === "web_serial") {
        return requestWebSerial<T>(deviceId, method, params);
      }
      return requestLocalUsb<T>(deviceId, method, params);
    },
    [requestLocalUsb, requestWebSerial],
  );

  const markChannelResult = useCallback(
    (deviceId: string, transport: DeviceTransport, res: Result<unknown>) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            channels: {
              ...current.channels,
              [transport]: {
                lastOkAt: res.ok
                  ? Date.now()
                  : current.channels[transport].lastOkAt,
                lastError: res.ok ? null : res.error,
              },
            },
          },
        };
      });
    },
    [],
  );

  const orderedTransports = useCallback(
    (deviceId: string): DeviceTransport[] => {
      const preferred = preferredTransportByDevice.current[deviceId];
      const active = preferred ?? runtimeById[deviceId]?.transport;
      const localUsbLinked =
        !!localUsbPortByDevice.current[deviceId] ||
        !!getLocalUsbDeviceLink(deviceId);
      return uniqueTransports([
        active,
        "http",
        "web_serial",
        localUsbLinked ? "local_usb" : null,
      ]);
    },
    [runtimeById],
  );

  const pollDevice = useCallback(
    async (deviceId: string, baseUrl: string) => {
      if (inflight.current.has(deviceId)) {
        return;
      }
      inflight.current.add(deviceId);
      try {
        let res: Result<PortsResponse> | null = null;
        let transport: DeviceTransport | null = null;
        for (const candidate of orderedTransports(deviceId)) {
          const candidateRes = await requestTransport<PortsResponse>(
            deviceId,
            baseUrl,
            candidate,
            "ports.get",
          );
          markChannelResult(deviceId, candidate, candidateRes);
          if (candidateRes.ok) {
            res = candidateRes;
            transport = candidate;
            preferredTransportByDevice.current[deviceId] = candidate;
            break;
          }
          res = candidateRes;
        }
        if (!res) {
          return;
        }
        setRuntimeById((prev) => {
          const current = prev[deviceId];
          if (!current) {
            return prev;
          }
          if (res.ok) {
            const hub = res.value.hub ?? null;
            const portA = res.value.ports.find((p) => p.portId === "port_a");
            const portC = res.value.ports.find((p) => p.portId === "port_c");
            if (!portA || !portC) {
              return {
                ...prev,
                [deviceId]: {
                  ...current,
                  lastError: {
                    kind: "invalid_response",
                    message:
                      "missing port_a or port_c in /api/v1/ports response",
                  },
                },
              };
            }
            return {
              ...prev,
              [deviceId]: {
                ...current,
                lastOkAt: Date.now(),
                lastError: null,
                transport,
                hub,
                ports: { port_a: portA, port_c: portC },
              },
            };
          }
          delete preferredTransportByDevice.current[deviceId];
          return {
            ...prev,
            [deviceId]: {
              ...current,
              lastError: res.error,
              transport,
            },
          };
        });
      } finally {
        inflight.current.delete(deviceId);
      }
    },
    [markChannelResult, orderedTransports, requestTransport],
  );
  const pollDeviceRef = useRef(pollDevice);

  useEffect(() => {
    pollDeviceRef.current = pollDevice;
  }, [pollDevice]);

  useEffect(() => {
    return subscribeLocalUsbDeviceLinks((link) => {
      localUsbPortByDevice.current[link.deviceId] = link.portPath;
      preferredTransportByDevice.current[link.deviceId] = "local_usb";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, device.baseUrl);
      }
    });
  }, [devices, pollDevice]);

  useEffect(() => {
    return subscribeWebSerialDeviceLinks((link) => {
      preferredTransportByDevice.current[link.deviceId] = "web_serial";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, device.baseUrl);
      }
    });
  }, [devices, pollDevice]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (cancelled) {
        return;
      }
      await Promise.all(
        devices.map((d) => pollDeviceRef.current(d.id, d.baseUrl)),
      );
    };

    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [devices]);

  const setPending = useCallback(
    (deviceId: string, portId: PortId, value: boolean) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            pending: { ...current.pending, [portId]: value },
          },
        };
      });
    },
    [],
  );

  const refreshDevice = useCallback(
    async (deviceId: string) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }
      await pollDevice(deviceId, device.baseUrl);
    },
    [devices, pollDevice],
  );

  const deviceInfo = useCallback(
    async (deviceId: string): Promise<Result<DeviceInfoResponse>> => {
      const device = devices.find((d) => d.id === deviceId);
      const activeTransport = runtimeById[deviceId]?.transport;
      if (!device || !activeTransport) {
        return {
          ok: false,
          error: {
            kind: "offline",
            message: "device has no active transport",
          },
        };
      }
      const res = await requestTransport<DeviceInfoResponse>(
        deviceId,
        device.baseUrl,
        activeTransport,
        "info",
      );
      const checked =
        res.ok && !isDeviceInfoResponse(res.value)
          ? ({
              ok: false,
              error: {
                kind: "invalid_response",
                message: "info response is missing device identity",
              },
            } satisfies Result<DeviceInfoResponse>)
          : res;
      markChannelResult(deviceId, activeTransport, checked);
      return checked;
    },
    [devices, markChannelResult, requestTransport, runtimeById],
  );

  const runDeviceCommand = useCallback(
    async <T,>(
      deviceId: string,
      method: string,
      params?: Record<string, unknown>,
      allowedTransports?: DeviceTransport[],
    ): Promise<Result<T>> => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return {
          ok: false,
          error: { kind: "offline", message: "device not found" },
        };
      }
      let res: Result<T> | null = null;
      const transports = allowedTransports
        ? orderedTransports(deviceId).filter((transport) =>
            allowedTransports.includes(transport),
          )
        : orderedTransports(deviceId);
      if (transports.length === 0) {
        return {
          ok: false,
          error: {
            kind: "offline",
            message: "Web Serial or Local USB connection required",
          },
        };
      }
      for (const transport of transports) {
        const candidate = await requestTransport<T>(
          deviceId,
          device.baseUrl,
          transport,
          method,
          params,
        );
        markChannelResult(deviceId, transport, candidate);
        if (candidate.ok) {
          preferredTransportByDevice.current[deviceId] = transport;
          res = candidate;
          break;
        }
        res = candidate;
      }
      if (!res) {
        return {
          ok: false,
          error: { kind: "offline", message: "device has no active transport" },
        };
      }
      return res;
    },
    [devices, markChannelResult, orderedTransports, requestTransport],
  );

  const wifiConfig = useCallback(
    async (deviceId: string): Promise<Result<WifiConfigResponse>> => {
      return runDeviceCommand<WifiConfigResponse>(deviceId, "wifi.get");
    },
    [runDeviceCommand],
  );

  const saveWifiConfig = useCallback(
    async (
      deviceId: string,
      input: WifiConfigInput,
    ): Promise<Result<WifiMutationResponse>> => {
      const res = await runDeviceCommand<WifiMutationResponse>(
        deviceId,
        "wifi.set",
        input,
        ["web_serial", "local_usb"],
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
  );

  const clearWifi = useCallback(
    async (deviceId: string): Promise<Result<WifiMutationResponse>> => {
      const res = await runDeviceCommand<WifiMutationResponse>(
        deviceId,
        "wifi.clear",
        undefined,
        ["web_serial", "local_usb"],
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
  );

  const reboot = useCallback(
    async (deviceId: string): Promise<Result<RebootResponse>> => {
      return runDeviceCommand<RebootResponse>(deviceId, "reboot", undefined, [
        "web_serial",
        "local_usb",
      ]);
    },
    [runDeviceCommand],
  );

  const handleApiErrorToast = useCallback(
    (deviceName: string, label: string, err: DeviceApiError) => {
      if (err.kind === "busy") {
        pushToast({
          message: `${deviceName}: ${label} is busy`,
          variant: "warning",
        });
        return;
      }
      pushToast({
        message: `${deviceName}: ${label} error (${err.kind})`,
        variant: "error",
      });
    },
    [pushToast],
  );

  const setPower = useCallback(
    async (deviceId: string, portId: PortId, enabled: boolean) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }

      const label = portId === "port_a" ? "USB-A" : "USB-C";
      setPending(deviceId, portId, true);
      try {
        let res: Result<{ accepted: true }> | null = null;
        for (const transport of orderedTransports(deviceId)) {
          const candidate = await requestTransport<{ accepted: true }>(
            deviceId,
            device.baseUrl,
            transport,
            "port.power_set",
            {
              port: portId,
              enabled,
            },
          );
          markChannelResult(deviceId, transport, candidate);
          if (candidate.ok) {
            preferredTransportByDevice.current[deviceId] = transport;
            res = candidate;
            break;
          }
          res = candidate;
        }
        if (!res) {
          return;
        }
        if (res.ok) {
          pushToast({
            message: `${device.name}: ${label} power set`,
            variant: "success",
          });
          await refreshDevice(deviceId);
          return;
        }
        handleApiErrorToast(device.name, label, res.error);
      } finally {
        setPending(deviceId, portId, false);
      }
    },
    [
      devices,
      handleApiErrorToast,
      pushToast,
      refreshDevice,
      markChannelResult,
      orderedTransports,
      requestTransport,
      setPending,
    ],
  );

  const replug = useCallback(
    async (deviceId: string, portId: PortId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }

      const label = portId === "port_a" ? "USB-A" : "USB-C";
      setPending(deviceId, portId, true);
      try {
        let res: Result<{ accepted: true }> | null = null;
        for (const transport of orderedTransports(deviceId)) {
          const candidate = await requestTransport<{ accepted: true }>(
            deviceId,
            device.baseUrl,
            transport,
            "port.replug",
            {
              port: portId,
            },
          );
          markChannelResult(deviceId, transport, candidate);
          if (candidate.ok) {
            preferredTransportByDevice.current[deviceId] = transport;
            res = candidate;
            break;
          }
          res = candidate;
        }
        if (!res) {
          return;
        }
        if (res.ok) {
          pushToast({
            message: `${device.name}: ${label} replug accepted`,
            variant: "success",
          });
          await refreshDevice(deviceId);
          return;
        }
        handleApiErrorToast(device.name, label, res.error);
      } finally {
        setPending(deviceId, portId, false);
      }
    },
    [
      devices,
      handleApiErrorToast,
      pushToast,
      refreshDevice,
      markChannelResult,
      orderedTransports,
      requestTransport,
      setPending,
    ],
  );

  const value = useMemo<DeviceRuntimeContextValue>(() => {
    const connectionState = (deviceId: string): ConnectionState => {
      const rt = runtimeById[deviceId];
      if (!rt || rt.lastOkAt === null) {
        return "unknown";
      }
      return now - rt.lastOkAt >= OFFLINE_THRESHOLD_MS ? "offline" : "online";
    };

    const lastOkAt = (deviceId: string): number | null =>
      runtimeById[deviceId]?.lastOkAt ?? null;

    const lastErrorLabel = (deviceId: string): string | null => {
      const rt = runtimeById[deviceId];
      if (!rt?.lastError) {
        return null;
      }
      return shortApiError(rt.lastError);
    };

    const transport = (deviceId: string): DeviceTransport | null =>
      runtimeById[deviceId]?.transport ?? null;

    const wifiManagementTransport = (
      deviceId: string,
    ): DeviceTransport | null => {
      const active = runtimeById[deviceId]?.transport ?? null;
      if (active === "web_serial" || active === "local_usb") {
        return active;
      }
      if (getWebSerialDeviceTransport(deviceId)) {
        return "web_serial";
      }
      if (
        localUsbPortByDevice.current[deviceId] ||
        getLocalUsbDeviceLink(deviceId)
      ) {
        return "local_usb";
      }
      return null;
    };

    const channelState = (
      deviceId: string,
      transport: DeviceTransport,
    ): ConnectionState => {
      const channel = runtimeById[deviceId]?.channels[transport];
      if (!channel?.lastOkAt) {
        return "unknown";
      }
      return now - channel.lastOkAt >= OFFLINE_THRESHOLD_MS
        ? "offline"
        : "online";
    };

    const hub = (deviceId: string): HubState | null =>
      runtimeById[deviceId]?.hub ?? null;

    const port = (deviceId: string, portId: PortId): Port | null =>
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
      clearWifiConfig: clearWifi,
      rebootDevice: reboot,
      setPower,
      replug,
    };
  }, [
    clearWifi,
    deviceInfo,
    now,
    reboot,
    refreshDevice,
    replug,
    runtimeById,
    saveWifiConfig,
    setPower,
    wifiConfig,
  ]);

  return (
    <DeviceRuntimeContext.Provider value={value}>
      {children}
    </DeviceRuntimeContext.Provider>
  );
}

function createEmptyChannels(): Record<DeviceTransport, ChannelRuntime> {
  return {
    http: { lastOkAt: null, lastError: null },
    web_serial: { lastOkAt: null, lastError: null },
    local_usb: { lastOkAt: null, lastError: null },
  };
}

function uniqueTransports(
  candidates: Array<DeviceTransport | null | undefined>,
): DeviceTransport[] {
  const seen = new Set<DeviceTransport>();
  const ordered: DeviceTransport[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    if (!TRANSPORTS.includes(candidate)) {
      continue;
    }
    seen.add(candidate);
    ordered.push(candidate);
  }
  return ordered;
}

function isDeviceInfoResponse(value: unknown): value is DeviceInfoResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const device = (value as { device?: unknown }).device;
  return !!device && typeof device === "object";
}

export function useDeviceRuntime(): DeviceRuntimeContextValue {
  const ctx = useContext(DeviceRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useDeviceRuntime must be used within <DeviceRuntimeProvider>",
    );
  }
  return ctx;
}
