import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDemoDesktopAgent,
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../domain/desktopAgent";
import type {
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  Result,
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
import type { PortsResponse } from "../domain/ports";
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
import { createDeviceRuntimeActions } from "./device-runtime-actions";
import { createSharedMutationController } from "./device-runtime-command-state";
import { DeviceRuntimeContext } from "./device-runtime-context";
import {
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
  const { runSharedMutation } = createSharedMutationController({
    currentTabId: coordination.currentTabId,
    createRpcRequestId,
    deviceMutationQueues,
    setRuntimeById,
  });

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

  const {
    clearIdleBias,
    clearWifi,
    handleRuntimeRpcRequest,
    idleBias,
    pdDiagnostics,
    powerConfig,
    reboot,
    replug,
    resetSettings,
    restoreDefaults,
    runIdleBias,
    savePowerConfig,
    saveWifiConfig,
    setIdleBias,
    setLock,
    setPower,
    setPowerRuntime,
    setRoute,
    wifiConfig,
  } = createDeviceRuntimeActions({
    coordinator,
    coordinationRole: coordination.role,
    currentTabId: coordination.currentTabId,
    deviceInfo,
    devices,
    isLeader,
    pushToast,
    requestLeaderRpc,
    refreshCanonicalPowerConfig,
    refreshDevice,
    runDeviceCommand,
    runSharedMutation,
    runtimeByIdRef,
    setRuntimeById,
    syncIdleBiasSnapshot,
    syncObservedPowerLock,
    syncPdDiagnosticsSnapshot,
    syncPowerConfigSnapshot,
  });

  rpcRequestHandlerRef.current = handleRuntimeRpcRequest;

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
