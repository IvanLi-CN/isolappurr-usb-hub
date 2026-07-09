import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDemoDesktopAgent,
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../domain/desktopAgent";
import type {
  DeviceApiError,
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigResponse,
  RebootResponse,
  Result,
  SettingsResetResponse,
  SettingsResetScope,
  WifiConfigInput,
  WifiConfigResponse,
  WifiMutationResponse,
} from "../domain/deviceApi";
import {
  isLocalUsbSuppressedForFlashDevice,
  subscribeFlashTransportLocks,
} from "../domain/flashTransportLocks";
import {
  nextJsonlRequestId,
  sendDevdLocalUsbJsonlRequest,
  sendLocalUsbJsonlRequest,
} from "../domain/hardwareConsole";
import {
  getLocalUsbDeviceLink,
  subscribeLocalUsbDeviceLinks,
} from "../domain/localUsbLinks";
import { subscribeNetworkDeviceLinks } from "../domain/networkLinks";
import type {
  PortId,
  PortsResponse,
  UsbCDownstreamRoute,
} from "../domain/ports";
import {
  forgetWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
  subscribeWebSerialDeviceLinks,
} from "../domain/webSerialLinks";
import { useToast } from "../ui/toast/ToastProvider";
import { useDemoMode } from "./demo-mode";
import { DeviceRuntimeContext } from "./device-runtime-context";
import {
  createEmptyChannels,
  type DeviceRuntime,
  type DeviceRuntimeContextValue,
  type DeviceTransport,
  getStablePowerLockOwner,
  httpBaseUrlForDevice,
  isDeviceInfoResponse,
  isLinkedTransportActive,
  type JsonlEnvelope,
  jsonlTimeoutMsForMethod,
  localUsbErrorToDeviceApiError,
  localUsbPortPathForDevice,
  recoverWifiClearLikeTimeout,
  resetLocalUsbRuntimeState,
  resetLocalUsbRuntimeStateForDevice,
  resolveActiveDeviceTransport,
  resolveLocalUsbTarget,
  resolveOrderedDeviceTransports,
  runQueuedDeviceRequest,
  shouldForgetWebSerialTransport,
  shouldResetLocalUsbConnectionCache,
  shouldReuseLocalUsbAgentForDemoMode,
  verifiedWifiHttpBaseUrl,
} from "./device-runtime-support";
import { requestHttpTransport } from "./device-runtime-transport";
import { buildDeviceRuntimeContextValue } from "./device-runtime-value";
import { useDevices } from "./devices-store";

export { useDeviceRuntime } from "./device-runtime-context";
export type {
  ConnectionState,
  DeviceTransport,
} from "./device-runtime-support";

export function DeviceRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { devices, rebindHttpBaseUrl } = useDevices();
  const { enabled: demoEnabled } = useDemoMode();
  const { pushToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [runtimeById, setRuntimeById] = useState<Record<string, DeviceRuntime>>(
    {},
  );
  const inflight = useRef<Set<string>>(new Set());
  const localUsbAgent = useRef<DesktopAgent | null>(null);
  const lastDemoEnabled = useRef(demoEnabled);
  const localUsbPortByDevice = useRef<Record<string, string>>({});
  const localUsbRequestQueues = useRef<Record<string, Promise<void>>>({});
  const httpRequestQueues = useRef<Record<string, Promise<void>>>({});
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
          delete localUsbPortByDevice.current[id];
          delete localUsbRequestQueues.current[id];
          delete httpRequestQueues.current[id];
          delete preferredTransportByDevice.current[id];
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
      if (
        shouldReuseLocalUsbAgentForDemoMode(localUsbAgent.current, demoEnabled)
      ) {
        return localUsbAgent.current;
      }
      localUsbAgent.current = null;
      const agent = demoEnabled
        ? createDemoDesktopAgent()
        : await tryBootstrapDesktopAgent();
      localUsbAgent.current = agent;
      return agent;
    }, [demoEnabled]);

  useEffect(() => {
    if (lastDemoEnabled.current === demoEnabled) {
      return;
    }
    lastDemoEnabled.current = demoEnabled;
    localUsbAgent.current = null;
    localUsbPortByDevice.current = {};
    for (const [deviceId, transport] of Object.entries(
      preferredTransportByDevice.current,
    )) {
      if (transport === "local_usb") {
        delete preferredTransportByDevice.current[deviceId];
      }
    }
    setRuntimeById((prev) => resetLocalUsbRuntimeState(prev));
  }, [demoEnabled]);

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
      const target = resolveLocalUsbTarget({
        deviceId,
        devices,
        cachedPortPath: localUsbPortByDevice.current[deviceId],
        linkedPortPath: getLocalUsbDeviceLink(deviceId),
      });
      if (target?.kind === "port_path") {
        localUsbPortByDevice.current[deviceId] = target.portPath;
      }
      if (!target) {
        return {
          ok: false,
          error: { kind: "offline", message: "Local USB device not found" },
        };
      }
      const timeoutMs = jsonlTimeoutMsForMethod(method, params);
      return runQueuedDeviceRequest(
        localUsbRequestQueues.current,
        deviceId,
        async () => {
          let caughtError: unknown = null;
          try {
            const request = {
              id: nextJsonlRequestId(),
              method,
              params,
              timeoutMs,
            };
            const response =
              target.kind === "devd_device"
                ? await sendDevdLocalUsbJsonlRequest(
                    agent,
                    target.deviceId,
                    request,
                  )
                : await sendLocalUsbJsonlRequest(
                    agent,
                    target.portPath,
                    request,
                  );
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
            caughtError = err;
          }
          const recovered = await recoverWifiClearLikeTimeout<T>(
            async (request) =>
              target.kind === "devd_device"
                ? await sendDevdLocalUsbJsonlRequest(
                    agent,
                    target.deviceId,
                    request,
                  )
                : await sendLocalUsbJsonlRequest(
                    agent,
                    target.portPath,
                    request,
                  ),
            method,
            params,
          );
          if (recovered) {
            return recovered;
          }
          if (shouldResetLocalUsbConnectionCache(caughtError)) {
            localUsbAgent.current = null;
            delete localUsbPortByDevice.current[deviceId];
          }
          return {
            ok: false,
            error: localUsbErrorToDeviceApiError(caughtError),
          };
        },
      );
    },
    [devices, getLocalUsbAgent],
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
        const timeoutMs = jsonlTimeoutMsForMethod(method, params);
        const response = await transport.request({
          id: nextJsonlRequestId(),
          method,
          params,
          timeoutMs,
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
        const recovered = await recoverWifiClearLikeTimeout<T>(
          async (request) => transport.request(request),
          method,
          params,
        );
        if (recovered) {
          return recovered;
        }
        if (shouldForgetWebSerialTransport(err)) {
          forgetWebSerialDeviceTransport(deviceId);
        }
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
        return runQueuedDeviceRequest(httpRequestQueues.current, deviceId, () =>
          requestHttpTransport<T>(baseUrl, method, params),
        );
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
      return resolveOrderedDeviceTransports({
        deviceId,
        devices,
        runtime: runtimeById[deviceId],
        preferred: preferredTransportByDevice.current[deviceId],
        localUsbPortPath: localUsbPortByDevice.current[deviceId],
        hasLocalUsbLink: Boolean(getLocalUsbDeviceLink(deviceId)),
        hasWebSerialLink: Boolean(getWebSerialDeviceTransport(deviceId)),
        localUsbSuppressed: isLocalUsbSuppressedForFlashDevice(deviceId),
      });
    },
    [devices, runtimeById],
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
            candidate === "http"
              ? httpBaseUrlForDevice(
                  devices.find((device) => device.id === deviceId) ?? {
                    id: deviceId,
                    name: deviceId,
                    baseUrl,
                  },
                )
              : baseUrl,
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
          const hasWebSerialLink = Boolean(
            getWebSerialDeviceTransport(deviceId),
          );
          const hasLocalUsbLink = Boolean(getLocalUsbDeviceLink(deviceId));
          const stored = devices.find((device) => device.id === deviceId);
          const httpLinked =
            !!stored?.transports?.httpBaseUrl ||
            (stored ? !localUsbPortPathForDevice(stored) : false);
          const localUsbSuppressed =
            isLocalUsbSuppressedForFlashDevice(deviceId);
          const localUsbLinked =
            !localUsbSuppressed &&
            (Boolean(localUsbPortByDevice.current[deviceId]) ||
              hasLocalUsbLink ||
              Boolean(stored ? localUsbPortPathForDevice(stored) : null));
          const activeTransport = isLinkedTransportActive({
            transport: current.transport,
            httpLinked,
            localUsbLinked,
            webSerialLinked: hasWebSerialLink,
          })
            ? current.transport
            : null;
          return {
            ...prev,
            [deviceId]: {
              ...current,
              lastError: res.error,
              transport: activeTransport,
            },
          };
        });
      } finally {
        inflight.current.delete(deviceId);
      }
    },
    [devices, markChannelResult, orderedTransports, requestTransport],
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
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [devices, pollDevice]);

  useEffect(() => {
    return subscribeWebSerialDeviceLinks((link) => {
      preferredTransportByDevice.current[link.deviceId] = "web_serial";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [devices, pollDevice]);

  useEffect(() => {
    return subscribeFlashTransportLocks((lock) => {
      delete localUsbPortByDevice.current[lock.deviceId];
      if (lock.transport === "web_serial") {
        preferredTransportByDevice.current[lock.deviceId] = "web_serial";
      } else if (
        preferredTransportByDevice.current[lock.deviceId] === "web_serial"
      ) {
        delete preferredTransportByDevice.current[lock.deviceId];
      }
      setRuntimeById((prev) =>
        resetLocalUsbRuntimeStateForDevice(prev, lock.deviceId),
      );
      const device = devices.find(
        (candidate) => candidate.id === lock.deviceId,
      );
      if (device) {
        void pollDevice(lock.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [devices, pollDevice]);

  useEffect(() => {
    return subscribeNetworkDeviceLinks((link) => {
      markChannelResult(link.deviceId, "http", {
        ok: true,
        value: { baseUrl: link.baseUrl },
      });
      const currentTransport = runtimeById[link.deviceId]?.transport;
      if (!currentTransport) {
        preferredTransportByDevice.current[link.deviceId] = "http";
      }
      void pollDevice(link.deviceId, link.baseUrl);
    });
  }, [markChannelResult, pollDevice, runtimeById]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (cancelled) {
        return;
      }
      await Promise.all(
        devices.map((d) =>
          pollDeviceRef.current(d.id, httpBaseUrlForDevice(d)),
        ),
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
      await pollDevice(deviceId, httpBaseUrlForDevice(device));
    },
    [devices, pollDevice],
  );

  const deviceInfo = useCallback(
    async (deviceId: string): Promise<Result<DeviceInfoResponse>> => {
      const device = devices.find((d) => d.id === deviceId);
      const activeTransport = resolveActiveDeviceTransport({
        deviceId,
        devices,
        runtime: runtimeById[deviceId],
        preferred: preferredTransportByDevice.current[deviceId],
        localUsbPortPath: localUsbPortByDevice.current[deviceId],
        hasLocalUsbLink: Boolean(getLocalUsbDeviceLink(deviceId)),
        hasWebSerialLink: Boolean(getWebSerialDeviceTransport(deviceId)),
      });
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
        activeTransport === "http"
          ? httpBaseUrlForDevice(device)
          : device.baseUrl,
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
      if (checked.ok) {
        preferredTransportByDevice.current[deviceId] = activeTransport;
        if (activeTransport === "http") {
          const rebound = verifiedWifiHttpBaseUrl(checked.value, deviceId);
          if (rebound) {
            void rebindHttpBaseUrl(deviceId, rebound);
          }
        }
      }
      return checked;
    },
    [
      devices,
      markChannelResult,
      rebindHttpBaseUrl,
      requestTransport,
      runtimeById,
    ],
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
          transport === "http" ? httpBaseUrlForDevice(device) : device.baseUrl,
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
      if (res.ok && method === "power.config_get") {
        const config = res.value as PowerConfigResponse;
        return {
          ok: true,
          value: {
            ...config,
            light_load_mode: config.light_load_mode === "fpwm" ? "fpwm" : "pfm",
          } as T,
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

  const resetSettings = useCallback(
    async (
      deviceId: string,
      scope: SettingsResetScope,
    ): Promise<Result<SettingsResetResponse>> => {
      const preferred: DeviceTransport[] | undefined =
        scope === "wifi" ? ["web_serial", "local_usb"] : undefined;
      const res = await runDeviceCommand<SettingsResetResponse>(
        deviceId,
        "settings.reset",
        scope === "other"
          ? { scope, owner: getStablePowerLockOwner(deviceId) }
          : { scope },
        preferred,
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

  const powerConfig = useCallback(
    async (deviceId: string): Promise<Result<PowerConfigResponse>> => {
      return runDeviceCommand<PowerConfigResponse>(
        deviceId,
        "power.config_get",
      );
    },
    [runDeviceCommand],
  );

  const pdDiagnostics = useCallback(
    async (deviceId: string): Promise<Result<PdDiagnosticsResponse>> => {
      return runDeviceCommand<PdDiagnosticsResponse>(
        deviceId,
        "pd.diagnostics_get",
      );
    },
    [runDeviceCommand],
  );

  const idleBias = useCallback(
    async (deviceId: string): Promise<Result<IdleBiasResponse>> => {
      return runDeviceCommand<IdleBiasResponse>(
        deviceId,
        "power.idle_bias_get",
      );
    },
    [runDeviceCommand],
  );

  const savePowerConfig = useCallback(
    async (
      deviceId: string,
      input: PowerConfigInput,
      owner: number,
    ): Promise<Result<PowerConfigResponse>> => {
      const res = await runDeviceCommand<PowerConfigResponse>(
        deviceId,
        "power.config_set",
        { config: input, owner },
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
  );

  const restoreDefaults = useCallback(
    async (
      deviceId: string,
      owner: number,
    ): Promise<Result<PowerConfigResponse>> => {
      const res = await runDeviceCommand<PowerConfigResponse>(
        deviceId,
        "power.config_defaults",
        { owner },
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
  );

  const setLock = useCallback(
    async (
      deviceId: string,
      owner: number,
      acquire: boolean,
    ): Promise<Result<PowerConfigResponse>> => {
      return runDeviceCommand<PowerConfigResponse>(deviceId, "power.lock", {
        owner,
        acquire,
      });
    },
    [runDeviceCommand],
  );

  const setIdleBias = useCallback(
    async (
      deviceId: string,
      correctionEnabled: boolean,
      owner: number,
    ): Promise<Result<IdleBiasResponse>> => {
      const res = await runDeviceCommand<IdleBiasResponse>(
        deviceId,
        "power.idle_bias_set",
        { correction_enabled: correctionEnabled, owner },
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
  );

  const runIdleBias = useCallback(
    async (
      deviceId: string,
      owner: number,
    ): Promise<Result<IdleBiasResponse>> => {
      return runDeviceCommand<IdleBiasResponse>(
        deviceId,
        "power.idle_bias_run",
        {
          owner,
        },
      );
    },
    [runDeviceCommand],
  );

  const clearIdleBias = useCallback(
    async (
      deviceId: string,
      owner: number,
    ): Promise<Result<IdleBiasResponse>> => {
      const res = await runDeviceCommand<IdleBiasResponse>(
        deviceId,
        "power.idle_bias_clear",
        { owner },
      );
      if (res.ok) {
        await refreshDevice(deviceId);
      }
      return res;
    },
    [refreshDevice, runDeviceCommand],
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

  const runPendingMutation = useCallback(
    async <T,>({
      deviceId,
      pendingPortId,
      method,
      params,
      errorLabel,
      successMessage,
      allowedTransports,
    }: {
      deviceId: string;
      pendingPortId: PortId;
      method: string;
      params?: Record<string, unknown>;
      errorLabel: string;
      successMessage: (deviceName: string, result: T) => string;
      allowedTransports?: DeviceTransport[];
    }): Promise<Result<T> | null> => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return null;
      }

      setPending(deviceId, pendingPortId, true);
      try {
        const result = await runDeviceCommand<T>(
          deviceId,
          method,
          params,
          allowedTransports,
        );
        if (result.ok) {
          pushToast({
            message: successMessage(device.name, result.value),
            variant: "success",
          });
          await refreshDevice(deviceId);
        } else {
          handleApiErrorToast(device.name, errorLabel, result.error);
        }
        return result;
      } finally {
        setPending(deviceId, pendingPortId, false);
      }
    },
    [
      devices,
      handleApiErrorToast,
      pushToast,
      refreshDevice,
      runDeviceCommand,
      setPending,
    ],
  );

  const setPower = useCallback(
    async (deviceId: string, portId: PortId, enabled: boolean) => {
      const label = portId === "port_a" ? "USB-A" : "USB-C";
      await runPendingMutation<{ accepted: true }>({
        deviceId,
        pendingPortId: portId,
        method: "port.power_set",
        params: {
          port: portId,
          enabled,
        },
        errorLabel: label,
        successMessage: (deviceName) => `${deviceName}: ${label} power set`,
      });
    },
    [runPendingMutation],
  );

  const setPowerRuntime = useCallback(
    async (
      deviceId: string,
      owner: number,
      action: "output" | "discharge",
      enabled: boolean,
    ): Promise<Result<PowerConfigResponse>> => {
      const label = action === "output" ? "Power" : "TPS discharge";
      const result = await runPendingMutation<PowerConfigResponse>({
        deviceId,
        pendingPortId: "port_c",
        method: "power.runtime_set",
        params: {
          action,
          enabled,
          owner,
        },
        errorLabel: label,
        successMessage: (deviceName) => `${deviceName}: ${label} updated`,
      });
      if (!result) {
        return {
          ok: false,
          error: {
            kind: "invalid_response",
            message: `Unknown device: ${deviceId}`,
          },
        };
      }
      return result;
    },
    [runPendingMutation],
  );

  const replug = useCallback(
    async (deviceId: string, portId: PortId) => {
      const label = portId === "port_a" ? "USB-A" : "USB-C";
      await runPendingMutation<{ accepted: true }>({
        deviceId,
        pendingPortId: portId,
        method: "port.replug",
        params: {
          port: portId,
        },
        errorLabel: label,
        successMessage: (deviceName) =>
          `${deviceName}: ${label} replug accepted`,
      });
    },
    [runPendingMutation],
  );

  const setRoute = useCallback(
    async (deviceId: string, route: UsbCDownstreamRoute) => {
      await runPendingMutation<{
        accepted: true;
        usb_c_downstream_route: UsbCDownstreamRoute;
        persisted: boolean;
      }>({
        deviceId,
        pendingPortId: "port_c",
        method: "hub.route_set",
        params: {
          route,
        },
        errorLabel: "USB-C route",
        successMessage: (deviceName, result) => {
          const label =
            result.usb_c_downstream_route === "mcu" ? "Upgrade" : "Normal";
          return `${deviceName}: USB-C mode set to ${label}`;
        },
      });
    },
    [runPendingMutation],
  );

  const value = useMemo<DeviceRuntimeContextValue>(() => {
    return buildDeviceRuntimeContextValue({
      now,
      runtimeById,
      devices,
      localUsbPortByDevice: localUsbPortByDevice.current,
      refreshDevice,
      deviceInfo,
      wifiConfig,
      saveWifiConfig,
      clearWifiConfig: clearWifi,
      resetSettings,
      rebootDevice: reboot,
      pdDiagnostics,
      powerConfig,
      idleBias,
      savePowerConfig,
      restorePowerDefaults: restoreDefaults,
      setPowerLock: setLock,
      setPowerRuntime,
      setIdleBiasCorrection: setIdleBias,
      runIdleBiasCalibration: runIdleBias,
      clearIdleBiasCalibration: clearIdleBias,
      setPower,
      replug,
      setUsbCDownstreamRoute: setRoute,
    });
  }, [
    clearWifi,
    deviceInfo,
    devices,
    idleBias,
    now,
    pdDiagnostics,
    powerConfig,
    reboot,
    refreshDevice,
    replug,
    resetSettings,
    restoreDefaults,
    runtimeById,
    savePowerConfig,
    saveWifiConfig,
    setPowerRuntime,
    clearIdleBias,
    setLock,
    setIdleBias,
    setRoute,
    setPower,
    runIdleBias,
    wifiConfig,
  ]);

  return (
    <DeviceRuntimeContext.Provider value={value}>
      {children}
    </DeviceRuntimeContext.Provider>
  );
}
