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
  FLASH_TRANSPORT_LOCK_ALL,
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
import {
  DEMO_RUNTIME_SCOPE,
  getSharedCrossTabRuntimeCoordinator,
  LIVE_RUNTIME_SCOPE,
  type RuntimeChannelMessage,
  type RuntimeRpcMethod,
  type RuntimeRpcResultMap,
  runtimeRpcMethodKind,
} from "./cross-tab-runtime";
import { useDemoMode } from "./demo-mode";
import { DeviceRuntimeContext } from "./device-runtime-context";
import {
  applyOptimisticPowerConfig,
  canResumePowerLock,
  clearPowerLockResume,
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
  markPowerLockHeld,
  recoverWifiClearLikeTimeout,
  resetLocalUsbRuntimeState,
  resetLocalUsbRuntimeStateForDevice,
  resolveActiveDeviceTransport,
  resolveLocalUsbTarget,
  resolveOrderedDeviceTransports,
  runQueuedDeviceRequest,
  type SharedRuntimeCommandKind,
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
  const coordinator = useMemo(
    () =>
      getSharedCrossTabRuntimeCoordinator(
        demoEnabled ? DEMO_RUNTIME_SCOPE : LIVE_RUNTIME_SCOPE,
      ),
    [demoEnabled],
  );
  const { pushToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [runtimeById, setRuntimeById] = useState<Record<string, DeviceRuntime>>(
    {},
  );
  const [coordination, setCoordination] = useState(() =>
    coordinator.getLeaseState(),
  );
  const inflight = useRef<Set<string>>(new Set());
  const runtimeByIdRef = useRef(runtimeById);
  const localUsbAgent = useRef<DesktopAgent | null>(null);
  const lastDemoEnabled = useRef(demoEnabled);
  const localUsbPortByDevice = useRef<Record<string, string>>({});
  const localUsbRequestQueues = useRef<Record<string, Promise<void>>>({});
  const httpRequestQueues = useRef<Record<string, Promise<void>>>({});
  const deviceMutationQueues = useRef<Record<string, Promise<void>>>({});
  const preferredTransportByDevice = useRef<Record<string, DeviceTransport>>(
    {},
  );
  const pendingRpc = useRef<
    Record<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
        timeoutId: number;
      }
    >
  >({});
  const rpcRequestHandlerRef = useRef<
    | ((
        message: Extract<
          RuntimeChannelMessage,
          { type: "runtime-rpc-request" }
        >,
      ) => Promise<void>)
    | null
  >(null);
  const wasLeaderRef = useRef(coordination.role !== "follower");
  const isLeader = coordination.role !== "follower";

  useEffect(() => {
    runtimeByIdRef.current = runtimeById;
  }, [runtimeById]);

  useEffect(() => {
    coordinator.start();
    const cachedSnapshot = coordinator.readSnapshot();
    if (cachedSnapshot) {
      setNow(cachedSnapshot.now);
      setRuntimeById(cachedSnapshot.runtimeById);
    }
    const unsubscribeLease = coordinator.subscribeLease(setCoordination);
    const unsubscribeMessages = coordinator.subscribeMessages((message) => {
      if (
        message.type === "runtime-snapshot" &&
        message.originTabId !== coordination.currentTabId &&
        !isLeader
      ) {
        setNow(message.snapshot.now);
        setRuntimeById(message.snapshot.runtimeById);
        return;
      }
      if (
        message.type === "runtime-rpc-response" &&
        message.targetTabId === coordination.currentTabId
      ) {
        const pending = pendingRpc.current[message.requestId];
        if (!pending) {
          return;
        }
        window.clearTimeout(pending.timeoutId);
        delete pendingRpc.current[message.requestId];
        pending.resolve(message.result);
        return;
      }
      if (message.type === "runtime-rpc-request" && isLeader) {
        void rpcRequestHandlerRef.current?.(message);
      }
    });
    return () => {
      unsubscribeMessages();
      unsubscribeLease();
      coordinator.stop();
    };
  }, [coordinator, coordination.currentTabId, isLeader]);

  useEffect(() => {
    if (!isLeader) {
      return;
    }
    coordinator.publishSnapshot({
      at: new Date().toISOString(),
      originTabId: coordination.currentTabId,
      now,
      runtimeById,
    });
  }, [coordinator, coordination.currentTabId, isLeader, now, runtimeById]);

  useEffect(() => {
    if (wasLeaderRef.current && !isLeader) {
      localUsbAgent.current = null;
      localUsbPortByDevice.current = {};
      for (const device of devices) {
        forgetWebSerialDeviceTransport(device.id);
      }
      setRuntimeById((prev) => resetLocalUsbRuntimeState(prev));
    }
    wasLeaderRef.current = isLeader;
  }, [devices, isLeader]);

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
          delete deviceMutationQueues.current[id];
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
            powerConfig: null,
            idleBias: null,
            pdDiagnostics: null,
            revision: 0,
            command: null,
          };
        }
      }
      return next;
    });
  }, [devices]);

  const createRpcRequestId = useCallback(() => {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  type SharedMutationInvocationOptions = {
    requestId?: string;
    sourceTabId?: string;
  };

  const runtimeRpcTimeoutMs = useCallback(
    (method: RuntimeRpcMethod): number => {
      if (method === "runIdleBiasCalibration") {
        return 190_000;
      }
      if (
        method === "savePowerConfig" ||
        method === "restorePowerDefaults" ||
        method === "setPowerLock" ||
        method === "setPowerRuntime" ||
        method === "setIdleBiasCorrection" ||
        method === "clearIdleBiasCalibration" ||
        method === "saveWifiConfig" ||
        method === "clearWifiConfig" ||
        method === "resetSettings" ||
        method === "rebootDevice" ||
        method === "setPower" ||
        method === "replug" ||
        method === "setUsbCDownstreamRoute"
      ) {
        return 25_000;
      }
      return 8_000;
    },
    [],
  );

  const requestLeaderRpc = useCallback(
    async <TMethod extends RuntimeRpcMethod>(
      method: TMethod,
      args: unknown[],
    ): Promise<RuntimeRpcResultMap[TMethod]> => {
      const requestId = createRpcRequestId();
      return new Promise<RuntimeRpcResultMap[TMethod]>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          delete pendingRpc.current[requestId];
          reject(new Error(`Cross-tab runtime request timed out: ${method}`));
        }, runtimeRpcTimeoutMs(method));
        pendingRpc.current[requestId] = {
          resolve: (value) => resolve(value as RuntimeRpcResultMap[TMethod]),
          reject,
          timeoutId,
        };
        coordinator.postMessage({
          type: "runtime-rpc-request",
          originTabId: coordination.currentTabId,
          requestId,
          kind: runtimeRpcMethodKind(method),
          method,
          args,
        });
      });
    },
    [
      coordinator,
      coordination.currentTabId,
      createRpcRequestId,
      runtimeRpcTimeoutMs,
    ],
  );

  const requestControlTakeover = useCallback(() => {
    coordinator.requestTakeover();
  }, [coordinator]);

  const updateDeviceCommandState = useCallback(
    (
      deviceId: string,
      update: (
        current: DeviceRuntime,
      ) => Pick<DeviceRuntime, "revision" | "command"> | null,
    ) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        const next = update(current);
        if (!next) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            revision: next.revision,
            command: next.command,
          },
        };
      });
    },
    [],
  );

  const markDeviceCommandState = useCallback(
    ({
      deviceId,
      requestId,
      sourceTabId,
      kind,
      method,
      state,
    }: {
      deviceId: string;
      requestId: string;
      sourceTabId: string;
      kind: SharedRuntimeCommandKind;
      method: string;
      state: "queued" | "running";
    }) => {
      updateDeviceCommandState(deviceId, (current) => {
        const existingCommand =
          current.command?.requestId === requestId ? current.command : null;
        return {
          revision: current.revision,
          command: {
            requestId,
            deviceId,
            sourceTabId,
            kind,
            method,
            state,
            queuedAt: existingCommand?.queuedAt ?? new Date().toISOString(),
            startedAt:
              state === "running"
                ? (existingCommand?.startedAt ?? new Date().toISOString())
                : null,
            finishedAt: null,
            revision: current.revision,
            errorMessage: null,
          },
        };
      });
    },
    [updateDeviceCommandState],
  );

  const finishDeviceCommandState = useCallback(
    ({
      deviceId,
      requestId,
      succeeded,
      incrementRevision,
      errorMessage,
    }: {
      deviceId: string;
      requestId: string;
      succeeded: boolean;
      incrementRevision: boolean;
      errorMessage?: string | null;
    }) => {
      updateDeviceCommandState(deviceId, (current) => {
        const nextRevision = incrementRevision
          ? current.revision + 1
          : current.revision;
        if (!current.command || current.command.requestId !== requestId) {
          return {
            revision: nextRevision,
            command: current.command,
          };
        }
        return {
          revision: nextRevision,
          command: {
            ...current.command,
            state: succeeded ? "done" : "failed",
            finishedAt: new Date().toISOString(),
            revision: nextRevision,
            errorMessage: errorMessage ?? null,
          },
        };
      });
    },
    [updateDeviceCommandState],
  );

  const runSharedMutation = useCallback(
    async <T,>({
      deviceId,
      method,
      invoke,
      requestId = createRpcRequestId(),
      sourceTabId = coordination.currentTabId,
    }: {
      deviceId: string;
      method: RuntimeRpcMethod;
      invoke: () => Promise<Result<T>>;
      requestId?: string;
      sourceTabId?: string;
    }): Promise<Result<T>> => {
      markDeviceCommandState({
        deviceId,
        requestId,
        sourceTabId,
        kind: "mutation",
        method,
        state: "queued",
      });
      return runQueuedDeviceRequest(
        deviceMutationQueues.current,
        deviceId,
        async () => {
          markDeviceCommandState({
            deviceId,
            requestId,
            sourceTabId,
            kind: "mutation",
            method,
            state: "running",
          });
          const result = await invoke();
          finishDeviceCommandState({
            deviceId,
            requestId,
            succeeded: result.ok,
            incrementRevision: result.ok,
            errorMessage: result.ok ? null : result.error.message,
          });
          return result;
        },
      );
    },
    [
      coordination.currentTabId,
      createRpcRequestId,
      finishDeviceCommandState,
      markDeviceCommandState,
    ],
  );

  const syncObservedPowerLock = useCallback(
    (
      deviceId: string,
      lock: PowerConfigResponse["lock"] | null | undefined,
      owner = getStablePowerLockOwner(deviceId),
    ) => {
      if (!lock) {
        return;
      }
      if (lock.owner === owner) {
        markPowerLockHeld(deviceId);
        return;
      }
      clearPowerLockResume(deviceId);
    },
    [],
  );

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

  const syncPowerConfigSnapshot = useCallback(
    (deviceId: string, nextConfig: PowerConfigResponse) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            powerConfig: nextConfig,
          },
        };
      });
    },
    [],
  );

  const syncIdleBiasSnapshot = useCallback(
    (deviceId: string, nextIdleBias: IdleBiasResponse) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            idleBias: nextIdleBias,
          },
        };
      });
    },
    [],
  );

  const syncPdDiagnosticsSnapshot = useCallback(
    (deviceId: string, nextPdDiagnostics: PdDiagnosticsResponse) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            pdDiagnostics: nextPdDiagnostics,
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
    if (!isLeader) {
      return () => {};
    }
    return subscribeLocalUsbDeviceLinks((link) => {
      localUsbPortByDevice.current[link.deviceId] = link.portPath;
      preferredTransportByDevice.current[link.deviceId] = "local_usb";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [devices, isLeader, pollDevice]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    return subscribeWebSerialDeviceLinks((link) => {
      preferredTransportByDevice.current[link.deviceId] = "web_serial";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [devices, isLeader, pollDevice]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    return subscribeFlashTransportLocks((lock) => {
      if (lock.deviceId === FLASH_TRANSPORT_LOCK_ALL) {
        setRuntimeById((prev) => resetLocalUsbRuntimeState(prev));
        for (const device of devices) {
          void pollDevice(device.id, httpBaseUrlForDevice(device));
        }
        return;
      }
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
  }, [devices, isLeader, pollDevice]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
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
  }, [isLeader, markChannelResult, pollDevice, runtimeById]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
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
  }, [devices, isLeader]);

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
      if (!isLeader && coordination.role !== "unsupported") {
        await requestLeaderRpc("refreshDevice", [deviceId]);
        return;
      }
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }
      await pollDevice(deviceId, httpBaseUrlForDevice(device));
    },
    [coordination.role, devices, isLeader, pollDevice, requestLeaderRpc],
  );

  const deviceInfo = useCallback(
    async (deviceId: string): Promise<Result<DeviceInfoResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("deviceInfo", [deviceId]);
      }
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
      coordination.role,
      devices,
      isLeader,
      markChannelResult,
      rebindHttpBaseUrl,
      requestLeaderRpc,
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

  const refreshCanonicalPowerConfig = useCallback(
    async (
      deviceId: string,
      owner?: number,
      fallback?: PowerConfigResponse,
    ): Promise<Result<PowerConfigResponse>> => {
      const snapshot = await runDeviceCommand<PowerConfigResponse>(
        deviceId,
        "power.config_get",
      );
      if (snapshot.ok) {
        syncObservedPowerLock(deviceId, snapshot.value.lock, owner);
        syncPowerConfigSnapshot(deviceId, snapshot.value);
        return snapshot;
      }
      if (!fallback) {
        return snapshot;
      }
      syncObservedPowerLock(deviceId, fallback.lock, owner);
      syncPowerConfigSnapshot(deviceId, fallback);
      return { ok: true, value: fallback };
    },
    [runDeviceCommand, syncObservedPowerLock, syncPowerConfigSnapshot],
  );

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    let cancelled = false;
    const renewLocks = async () => {
      for (const device of devices) {
        const runtime = runtimeByIdRef.current[device.id];
        const lock = runtime?.powerConfig?.lock;
        const owner = getStablePowerLockOwner(device.id);
        if (!lock || lock.owner !== owner || !canResumePowerLock(device.id)) {
          continue;
        }
        const renewal = await runDeviceCommand<PowerConfigResponse>(
          device.id,
          "power.lock",
          {
            owner,
            acquire: true,
          },
        );
        if (cancelled) {
          return;
        }
        if (renewal.ok) {
          markPowerLockHeld(device.id);
          await refreshCanonicalPowerConfig(device.id, owner, renewal.value);
          continue;
        }
        const snapshot = await refreshCanonicalPowerConfig(device.id, owner);
        if (!cancelled && snapshot.ok && snapshot.value.lock?.owner === owner) {
          markPowerLockHeld(device.id);
        }
      }
    };
    const intervalId = window.setInterval(() => void renewLocks(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [devices, isLeader, refreshCanonicalPowerConfig, runDeviceCommand]);

  const wifiConfig = useCallback(
    async (deviceId: string): Promise<Result<WifiConfigResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("wifiConfig", [deviceId]);
      }
      return runDeviceCommand<WifiConfigResponse>(deviceId, "wifi.get");
    },
    [coordination.role, isLeader, requestLeaderRpc, runDeviceCommand],
  );

  const saveWifiConfig = useCallback(
    async (
      deviceId: string,
      input: WifiConfigInput,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<WifiMutationResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("saveWifiConfig", [deviceId, input]);
      }
      return runSharedMutation({
        deviceId,
        method: "saveWifiConfig",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
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
      });
    },
    [
      coordination.role,
      isLeader,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const clearWifi = useCallback(
    async (
      deviceId: string,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<WifiMutationResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("clearWifiConfig", [deviceId]);
      }
      return runSharedMutation({
        deviceId,
        method: "clearWifiConfig",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
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
      });
    },
    [
      coordination.role,
      isLeader,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const resetSettings = useCallback(
    async (
      deviceId: string,
      scope: SettingsResetScope,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<SettingsResetResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("resetSettings", [deviceId, scope]);
      }
      return runSharedMutation({
        deviceId,
        method: "resetSettings",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
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
      });
    },
    [
      coordination.role,
      isLeader,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const reboot = useCallback(
    async (
      deviceId: string,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<RebootResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("rebootDevice", [deviceId]);
      }
      return runSharedMutation({
        deviceId,
        method: "rebootDevice",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () =>
          runDeviceCommand<RebootResponse>(deviceId, "reboot", undefined, [
            "web_serial",
            "local_usb",
          ]),
      });
    },
    [
      coordination.role,
      isLeader,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const powerConfig = useCallback(
    async (deviceId: string): Promise<Result<PowerConfigResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("powerConfig", [deviceId]);
      }
      return refreshCanonicalPowerConfig(deviceId);
    },
    [
      coordination.role,
      refreshCanonicalPowerConfig,
      isLeader,
      requestLeaderRpc,
    ],
  );

  const pdDiagnostics = useCallback(
    async (deviceId: string): Promise<Result<PdDiagnosticsResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("pdDiagnostics", [deviceId]);
      }
      const res = await runDeviceCommand<PdDiagnosticsResponse>(
        deviceId,
        "pd.diagnostics_get",
      );
      if (res.ok) {
        syncPdDiagnosticsSnapshot(deviceId, res.value);
      }
      return res;
    },
    [
      coordination.role,
      isLeader,
      requestLeaderRpc,
      runDeviceCommand,
      syncPdDiagnosticsSnapshot,
    ],
  );

  const idleBias = useCallback(
    async (deviceId: string): Promise<Result<IdleBiasResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("idleBias", [deviceId]);
      }
      const res = await runDeviceCommand<IdleBiasResponse>(
        deviceId,
        "power.idle_bias_get",
      );
      if (res.ok) {
        syncIdleBiasSnapshot(deviceId, res.value);
      }
      return res;
    },
    [
      coordination.role,
      isLeader,
      requestLeaderRpc,
      runDeviceCommand,
      syncIdleBiasSnapshot,
    ],
  );

  const savePowerConfig = useCallback(
    async (
      deviceId: string,
      input: PowerConfigInput,
      owner: number,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<PowerConfigResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("savePowerConfig", [deviceId, input, owner]);
      }
      return runSharedMutation({
        deviceId,
        method: "savePowerConfig",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const previousPowerConfig =
            runtimeByIdRef.current[deviceId]?.powerConfig ?? null;
          const optimisticPowerConfig = applyOptimisticPowerConfig(
            previousPowerConfig,
            input,
          );
          if (optimisticPowerConfig) {
            syncObservedPowerLock(deviceId, optimisticPowerConfig.lock, owner);
            syncPowerConfigSnapshot(deviceId, optimisticPowerConfig);
          }
          const res = await runDeviceCommand<PowerConfigResponse>(
            deviceId,
            "power.config_set",
            { config: input, owner },
          );
          if (res.ok) {
            const canonical = await refreshCanonicalPowerConfig(
              deviceId,
              owner,
              res.value,
            );
            await refreshDevice(deviceId);
            return canonical;
          }
          if (previousPowerConfig) {
            syncPowerConfigSnapshot(deviceId, previousPowerConfig);
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      isLeader,
      refreshCanonicalPowerConfig,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
      syncObservedPowerLock,
      syncPowerConfigSnapshot,
    ],
  );

  const restoreDefaults = useCallback(
    async (
      deviceId: string,
      owner: number,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<PowerConfigResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("restorePowerDefaults", [deviceId, owner]);
      }
      return runSharedMutation({
        deviceId,
        method: "restorePowerDefaults",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const res = await runDeviceCommand<PowerConfigResponse>(
            deviceId,
            "power.config_defaults",
            { owner },
          );
          if (res.ok) {
            const canonical = await refreshCanonicalPowerConfig(
              deviceId,
              owner,
              res.value,
            );
            await refreshDevice(deviceId);
            return canonical;
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      isLeader,
      refreshCanonicalPowerConfig,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const setLock = useCallback(
    async (
      deviceId: string,
      owner: number,
      acquire: boolean,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<PowerConfigResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("setPowerLock", [deviceId, owner, acquire]);
      }
      return runSharedMutation({
        deviceId,
        method: "setPowerLock",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const res = await runDeviceCommand<PowerConfigResponse>(
            deviceId,
            "power.lock",
            {
              owner,
              acquire,
            },
          );
          if (res.ok) {
            if (acquire && res.value.lock?.owner === owner) {
              markPowerLockHeld(deviceId);
            } else if (!acquire) {
              clearPowerLockResume(deviceId);
            }
            return refreshCanonicalPowerConfig(
              deviceId,
              acquire ? owner : undefined,
              res.value,
            );
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      refreshCanonicalPowerConfig,
      isLeader,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
    ],
  );

  const setIdleBias = useCallback(
    async (
      deviceId: string,
      correctionEnabled: boolean,
      owner: number,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<IdleBiasResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("setIdleBiasCorrection", [
          deviceId,
          correctionEnabled,
          owner,
        ]);
      }
      return runSharedMutation({
        deviceId,
        method: "setIdleBiasCorrection",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const res = await runDeviceCommand<IdleBiasResponse>(
            deviceId,
            "power.idle_bias_set",
            { correction_enabled: correctionEnabled, owner },
          );
          if (res.ok) {
            syncIdleBiasSnapshot(deviceId, res.value);
            await refreshDevice(deviceId);
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      isLeader,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
      syncIdleBiasSnapshot,
    ],
  );

  const runIdleBias = useCallback(
    async (
      deviceId: string,
      owner: number,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<IdleBiasResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("runIdleBiasCalibration", [deviceId, owner]);
      }
      return runSharedMutation({
        deviceId,
        method: "runIdleBiasCalibration",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const res = await runDeviceCommand<IdleBiasResponse>(
            deviceId,
            "power.idle_bias_run",
            {
              owner,
            },
          );
          if (res.ok) {
            syncIdleBiasSnapshot(deviceId, res.value);
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      isLeader,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
      syncIdleBiasSnapshot,
    ],
  );

  const clearIdleBias = useCallback(
    async (
      deviceId: string,
      owner: number,
      options?: SharedMutationInvocationOptions,
    ): Promise<Result<IdleBiasResponse>> => {
      if (!isLeader && coordination.role !== "unsupported") {
        return requestLeaderRpc("clearIdleBiasCalibration", [deviceId, owner]);
      }
      return runSharedMutation({
        deviceId,
        method: "clearIdleBiasCalibration",
        requestId: options?.requestId,
        sourceTabId: options?.sourceTabId,
        invoke: async () => {
          const res = await runDeviceCommand<IdleBiasResponse>(
            deviceId,
            "power.idle_bias_clear",
            { owner },
          );
          if (res.ok) {
            syncIdleBiasSnapshot(deviceId, res.value);
            await refreshDevice(deviceId);
          }
          return res;
        },
      });
    },
    [
      coordination.role,
      isLeader,
      refreshDevice,
      requestLeaderRpc,
      runDeviceCommand,
      runSharedMutation,
      syncIdleBiasSnapshot,
    ],
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
      allowedTransports,
    }: {
      deviceId: string;
      pendingPortId: PortId;
      method: string;
      params?: Record<string, unknown>;
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
          await refreshDevice(deviceId);
        }
        return result;
      } finally {
        setPending(deviceId, pendingPortId, false);
      }
    },
    [devices, refreshDevice, runDeviceCommand, setPending],
  );

  const setPower = useCallback(
    async (deviceId: string, portId: PortId, enabled: boolean) => {
      const label = portId === "port_a" ? "USB-A" : "USB-C";
      const deviceName =
        devices.find((device) => device.id === deviceId)?.name ?? deviceId;
      const result =
        !isLeader && coordination.role !== "unsupported"
          ? await requestLeaderRpc("setPower", [deviceId, portId, enabled])
          : await runSharedMutation({
              deviceId,
              method: "setPower",
              invoke: async () => {
                const direct = await runPendingMutation<{ accepted: true }>({
                  deviceId,
                  pendingPortId: portId,
                  method: "port.power_set",
                  params: {
                    port: portId,
                    enabled,
                  },
                });
                return (
                  direct ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
      if (result.ok) {
        pushToast({
          message: `${deviceName}: ${label} power set`,
          variant: "success",
        });
        return;
      }
      handleApiErrorToast(deviceName, label, result.error);
    },
    [
      coordination.role,
      devices,
      handleApiErrorToast,
      isLeader,
      pushToast,
      requestLeaderRpc,
      runPendingMutation,
      runSharedMutation,
    ],
  );

  const setPowerRuntime = useCallback(
    async (
      deviceId: string,
      owner: number,
      action: "output" | "discharge",
      enabled: boolean,
    ): Promise<Result<PowerConfigResponse>> => {
      const label = action === "output" ? "Power" : "TPS discharge";
      const deviceName =
        devices.find((device) => device.id === deviceId)?.name ?? deviceId;
      const result =
        !isLeader && coordination.role !== "unsupported"
          ? await requestLeaderRpc("setPowerRuntime", [
              deviceId,
              owner,
              action,
              enabled,
            ])
          : await runSharedMutation({
              deviceId,
              method: "setPowerRuntime",
              invoke: async () => {
                const direct = await runPendingMutation<PowerConfigResponse>({
                  deviceId,
                  pendingPortId: "port_c",
                  method: "power.runtime_set",
                  params: {
                    action,
                    enabled,
                    owner,
                  },
                });
                if (!direct?.ok) {
                  return (
                    direct ?? {
                      ok: false,
                      error: {
                        kind: "invalid_response",
                        message: `Unknown device: ${deviceId}`,
                      },
                    }
                  );
                }
                return refreshCanonicalPowerConfig(
                  deviceId,
                  owner,
                  direct.value,
                );
              },
            });
      if (result.ok) {
        syncObservedPowerLock(deviceId, result.value.lock, owner);
        syncPowerConfigSnapshot(deviceId, result.value);
        pushToast({
          message: `${deviceName}: ${label} updated`,
          variant: "success",
        });
      } else {
        handleApiErrorToast(deviceName, label, result.error);
      }
      return result;
    },
    [
      coordination.role,
      devices,
      handleApiErrorToast,
      isLeader,
      pushToast,
      refreshCanonicalPowerConfig,
      requestLeaderRpc,
      runPendingMutation,
      runSharedMutation,
      syncObservedPowerLock,
      syncPowerConfigSnapshot,
    ],
  );

  const replug = useCallback(
    async (deviceId: string, portId: PortId) => {
      const label = portId === "port_a" ? "USB-A" : "USB-C";
      const deviceName =
        devices.find((device) => device.id === deviceId)?.name ?? deviceId;
      const result =
        !isLeader && coordination.role !== "unsupported"
          ? await requestLeaderRpc("replug", [deviceId, portId])
          : await runSharedMutation({
              deviceId,
              method: "replug",
              invoke: async () => {
                const direct = await runPendingMutation<{ accepted: true }>({
                  deviceId,
                  pendingPortId: portId,
                  method: "port.replug",
                  params: {
                    port: portId,
                  },
                });
                return (
                  direct ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
      if (result.ok) {
        pushToast({
          message: `${deviceName}: ${label} replug accepted`,
          variant: "success",
        });
        return;
      }
      handleApiErrorToast(deviceName, label, result.error);
    },
    [
      coordination.role,
      devices,
      handleApiErrorToast,
      isLeader,
      pushToast,
      requestLeaderRpc,
      runPendingMutation,
      runSharedMutation,
    ],
  );

  const setRoute = useCallback(
    async (deviceId: string, route: UsbCDownstreamRoute) => {
      const deviceName =
        devices.find((device) => device.id === deviceId)?.name ?? deviceId;
      const result =
        !isLeader && coordination.role !== "unsupported"
          ? await requestLeaderRpc("setUsbCDownstreamRoute", [deviceId, route])
          : await runSharedMutation({
              deviceId,
              method: "setUsbCDownstreamRoute",
              invoke: async () => {
                const direct = await runPendingMutation<{
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
                });
                return (
                  direct ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
      if (result.ok) {
        const label =
          result.value.usb_c_downstream_route === "mcu" ? "Upgrade" : "Normal";
        pushToast({
          message: `${deviceName}: USB-C mode set to ${label}`,
          variant: "success",
        });
        return;
      }
      handleApiErrorToast(deviceName, "USB-C route", result.error);
    },
    [
      coordination.role,
      devices,
      handleApiErrorToast,
      isLeader,
      pushToast,
      requestLeaderRpc,
      runPendingMutation,
      runSharedMutation,
    ],
  );

  rpcRequestHandlerRef.current = async (message) => {
    const deviceId = String(message.args[0] ?? "");
    try {
      let result:
        | Result<{ ok: true }>
        | Result<DeviceInfoResponse>
        | Result<WifiConfigResponse>
        | Result<WifiMutationResponse>
        | Result<SettingsResetResponse>
        | Result<RebootResponse>
        | Result<PowerConfigResponse>
        | Result<IdleBiasResponse>
        | Result<PdDiagnosticsResponse>
        | Result<{ accepted: true }>
        | Result<{
            accepted: true;
            usb_c_downstream_route: UsbCDownstreamRoute;
            persisted: boolean;
          }>;
      switch (message.method) {
        case "refreshDevice":
          await refreshDevice(deviceId);
          result = { ok: true, value: { ok: true } };
          break;
        case "deviceInfo":
          result = await deviceInfo(deviceId);
          break;
        case "wifiConfig":
          result = await wifiConfig(deviceId);
          break;
        case "saveWifiConfig":
          result = await saveWifiConfig(
            deviceId,
            message.args[1] as WifiConfigInput,
            {
              requestId: message.requestId,
              sourceTabId: message.originTabId,
            },
          );
          break;
        case "clearWifiConfig":
          result = await clearWifi(deviceId, {
            requestId: message.requestId,
            sourceTabId: message.originTabId,
          });
          break;
        case "resetSettings":
          result = await resetSettings(
            deviceId,
            message.args[1] as SettingsResetScope,
            {
              requestId: message.requestId,
              sourceTabId: message.originTabId,
            },
          );
          break;
        case "rebootDevice":
          result = await reboot(deviceId, {
            requestId: message.requestId,
            sourceTabId: message.originTabId,
          });
          break;
        case "powerConfig":
          result = await powerConfig(deviceId);
          break;
        case "savePowerConfig":
          result = await savePowerConfig(
            deviceId,
            message.args[1] as PowerConfigInput,
            Number(message.args[2]),
            {
              requestId: message.requestId,
              sourceTabId: message.originTabId,
            },
          );
          break;
        case "restorePowerDefaults":
          result = await restoreDefaults(deviceId, Number(message.args[1]), {
            requestId: message.requestId,
            sourceTabId: message.originTabId,
          });
          break;
        case "setPowerLock":
          result = await setLock(
            deviceId,
            Number(message.args[1]),
            Boolean(message.args[2]),
            {
              requestId: message.requestId,
              sourceTabId: message.originTabId,
            },
          );
          break;
        case "setPowerRuntime":
          result = await (async () => {
            const owner = Number(message.args[1]);
            const action = message.args[2] as "output" | "discharge";
            const enabled = Boolean(message.args[3]);
            const direct = await runSharedMutation({
              deviceId,
              method: "setPowerRuntime",
              requestId: message.requestId,
              sourceTabId: message.originTabId,
              invoke: async () => {
                const queued = await runPendingMutation<PowerConfigResponse>({
                  deviceId,
                  pendingPortId: "port_c",
                  method: "power.runtime_set",
                  params: {
                    action,
                    enabled,
                    owner,
                  },
                });
                if (!queued?.ok) {
                  return (
                    queued ?? {
                      ok: false,
                      error: {
                        kind: "invalid_response",
                        message: `Unknown device: ${deviceId}`,
                      },
                    }
                  );
                }
                return refreshCanonicalPowerConfig(
                  deviceId,
                  owner,
                  queued.value,
                );
              },
            });
            return direct;
          })();
          break;
        case "idleBias":
          result = await idleBias(deviceId);
          break;
        case "setIdleBiasCorrection":
          result = await setIdleBias(
            deviceId,
            Boolean(message.args[1]),
            Number(message.args[2]),
            {
              requestId: message.requestId,
              sourceTabId: message.originTabId,
            },
          );
          break;
        case "runIdleBiasCalibration":
          result = await runIdleBias(deviceId, Number(message.args[1]), {
            requestId: message.requestId,
            sourceTabId: message.originTabId,
          });
          break;
        case "clearIdleBiasCalibration":
          result = await clearIdleBias(deviceId, Number(message.args[1]), {
            requestId: message.requestId,
            sourceTabId: message.originTabId,
          });
          break;
        case "pdDiagnostics":
          result = await pdDiagnostics(deviceId);
          break;
        case "setPower":
          result = await (async () => {
            const portId = message.args[1] as PortId;
            const enabled = Boolean(message.args[2]);
            return runSharedMutation({
              deviceId,
              method: "setPower",
              requestId: message.requestId,
              sourceTabId: message.originTabId,
              invoke: async () => {
                const queued = await runPendingMutation<{ accepted: true }>({
                  deviceId,
                  pendingPortId: portId,
                  method: "port.power_set",
                  params: {
                    port: portId,
                    enabled,
                  },
                });
                return (
                  queued ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
          })();
          break;
        case "replug":
          result = await (async () => {
            const portId = message.args[1] as PortId;
            return runSharedMutation({
              deviceId,
              method: "replug",
              requestId: message.requestId,
              sourceTabId: message.originTabId,
              invoke: async () => {
                const queued = await runPendingMutation<{ accepted: true }>({
                  deviceId,
                  pendingPortId: portId,
                  method: "port.replug",
                  params: {
                    port: portId,
                  },
                });
                return (
                  queued ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
          })();
          break;
        case "setUsbCDownstreamRoute":
          result = await (async () => {
            const route = message.args[1] as UsbCDownstreamRoute;
            const direct = await runSharedMutation({
              deviceId,
              method: "setUsbCDownstreamRoute",
              requestId: message.requestId,
              sourceTabId: message.originTabId,
              invoke: async () => {
                const queued = await runPendingMutation<{
                  accepted: true;
                  usb_c_downstream_route: UsbCDownstreamRoute;
                  persisted: boolean;
                }>({
                  deviceId,
                  pendingPortId: "port_c",
                  method: "hub.route_set",
                  params: { route },
                });
                return (
                  queued ?? {
                    ok: false,
                    error: {
                      kind: "invalid_response",
                      message: `Unknown device: ${deviceId}`,
                    },
                  }
                );
              },
            });
            return direct;
          })();
          break;
      }
      coordinator.postMessage({
        type: "runtime-rpc-response",
        originTabId: coordination.currentTabId,
        targetTabId: message.originTabId,
        requestId: message.requestId,
        result,
      });
    } catch (err) {
      coordinator.postMessage({
        type: "runtime-rpc-response",
        originTabId: coordination.currentTabId,
        targetTabId: message.originTabId,
        requestId: message.requestId,
        result: {
          ok: false,
          error: {
            kind: "api_error",
            status: 500,
            code: "cross_tab_runtime_error",
            message:
              err instanceof Error
                ? err.message
                : "Cross-tab runtime request failed",
            retryable: true,
          },
        },
      });
    }
  };

  const value = useMemo<DeviceRuntimeContextValue>(() => {
    return buildDeviceRuntimeContextValue({
      now,
      runtimeById,
      coordination,
      canControlHardware: true,
      powerLockOwner: getStablePowerLockOwner,
      requestControlTakeover,
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
    coordination,
    deviceInfo,
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
    requestControlTakeover,
    wifiConfig,
  ]);

  return (
    <DeviceRuntimeContext.Provider value={value}>
      {children}
    </DeviceRuntimeContext.Provider>
  );
}
