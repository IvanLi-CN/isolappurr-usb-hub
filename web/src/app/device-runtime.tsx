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
import { deviceNameCacheFromInfo } from "../domain/deviceName";
import {
  FLASH_TRANSPORT_LOCK_ALL,
  isLocalUsbSuppressedForFlashDevice,
  subscribeFlashTransportLocks,
} from "../domain/flashTransportLocks";
import {
  nextJsonlRequestId,
  sendDevdLocalUsbJsonlRequest,
  sendDevdLocalUsbJsonlRequestWithPortPath,
  sendLocalUsbJsonlRequest,
} from "../domain/hardwareConsole";
import {
  getLocalUsbDeviceLink,
  subscribeLocalUsbDeviceLinks,
} from "../domain/localUsbLinks";
import { subscribeNetworkDeviceLinks } from "../domain/networkLinks";
import { type PortsResponse, runtimePortsFromResponse } from "../domain/ports";
import {
  forgetWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
  subscribeWebSerialDeviceLinks,
} from "../domain/webSerialLinks";
import { useToast } from "../ui/toast/ToastProvider";
import {
  type CrossTabRuntimeCoordinator,
  type CrossTabRuntimeLeaseState,
  DEMO_RUNTIME_SCOPE,
  getSharedCrossTabRuntimeCoordinator,
  LIVE_RUNTIME_SCOPE,
  type RuntimeChannelMessage,
} from "./cross-tab-runtime";
import { useDemoMode } from "./demo-mode";
import { createDeviceRuntimeActions } from "./device-runtime-actions";
import { createSharedMutationController } from "./device-runtime-command-state";
import { DeviceRuntimeContext } from "./device-runtime-context";
import {
  createRuntimeRpcRequestId,
  useObservedPowerLockSync,
} from "./device-runtime-helpers";
import { useDeviceRuntimePowerLock } from "./device-runtime-power-lock";
import {
  createRequestLeaderRpc,
  type PendingRuntimeRpc,
  settlePendingRuntimeRpc,
} from "./device-runtime-rpc";
import {
  markDeviceRuntimeChannel,
  syncDeviceRuntimeIdleBias,
  syncDeviceRuntimePdDiagnostics,
  syncDeviceRuntimePowerConfig,
} from "./device-runtime-snapshots";
import {
  type ActiveConnectionEndpoint,
  createEmptyChannels,
  type DeviceRuntime,
  type DeviceRuntimeContextValue,
  type DeviceTransport,
  fenceRuntimeMutationResult,
  getStablePowerLockOwner,
  httpBaseUrlForDevice,
  isDeviceInfoResponse,
  isLinkedTransportActive,
  type JsonlEnvelope,
  jsonlTimeoutMsForMethod,
  localUsbErrorToDeviceApiError,
  localUsbPortPathForDevice,
  RUNTIME_MUTATION_METHODS,
  recoverWifiClearLikeTimeout,
  resetLocalUsbRuntimeState,
  resetLocalUsbRuntimeStateForDevice,
  resolveActiveDeviceTransport,
  resolveLocalUsbTarget,
  resolveOrderedDeviceTransports,
  resolvePolledActiveEndpoint,
  runQueuedDeviceRequestWithAuthorization,
  runtimeMutationDispatchError,
  shouldResetLocalUsbConnectionCache,
  shouldReuseLocalUsbAgentForDemoMode,
  takeoverRecoveryError,
  verifiedWifiHttpBaseUrl,
} from "./device-runtime-support";
import { requestHttpTransport } from "./device-runtime-transport";
import { buildDeviceRuntimeContextValue } from "./device-runtime-value";
import { createWebSerialEndpointRequester } from "./device-runtime-web-serial";
import { useDevices } from "./devices-store";

export { useDeviceRuntime } from "./device-runtime-context";
export type {
  ActiveConnectionEndpoint,
  ConnectionPresentation,
  ConnectionState,
  DeviceTransport,
} from "./device-runtime-support";

type TransportDispatch<T> = {
  result: Result<T>;
  binding: object | string | null;
  endpoint: ActiveConnectionEndpoint | null;
};

export function DeviceRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { devices, rebindHttpBaseUrl, updateDeviceNameCache } = useDevices();
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
  const snapshotHydratedFor = useRef<CrossTabRuntimeCoordinator | null>(null);
  const [coordination, setCoordination] = useState(() =>
    coordinator.getLeaseState(),
  );
  const inflight = useRef<Set<string>>(new Set());
  const pollGeneration = useRef<Record<string, number>>({});
  const invalidateDevicePoll = useCallback((deviceId: string) => {
    pollGeneration.current[deviceId] =
      (pollGeneration.current[deviceId] ?? 0) + 1;
  }, []);
  const clearActiveEndpoint = useCallback((deviceId: string) => {
    setRuntimeById((prev) => {
      const current = prev[deviceId];
      if (!current || current.activeEndpoint === null) {
        return prev;
      }
      return {
        ...prev,
        [deviceId]: { ...current, activeEndpoint: null },
      };
    });
  }, []);
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
  const pendingRpc = useRef<Record<string, PendingRuntimeRpc>>({});
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
  const isLeaderRef = useRef(isLeader);
  isLeaderRef.current = isLeader;
  const getMutationDispatchAuthorizationError = useCallback(
    (method: string) =>
      runtimeMutationDispatchError(method, coordinator.hasCurrentLease()),
    [coordinator],
  );
  const requestWebSerialWithEndpoint = useMemo(
    () =>
      createWebSerialEndpointRequester({
        getDispatchAuthorizationError: getMutationDispatchAuthorizationError,
      }),
    [getMutationDispatchAuthorizationError],
  );

  useEffect(() => {
    runtimeByIdRef.current = runtimeById;
  }, [runtimeById]);

  useEffect(() => {
    const currentTabId = coordinator.getTabId();
    coordinator.start();
    if (snapshotHydratedFor.current !== coordinator) {
      snapshotHydratedFor.current = coordinator;
      const cachedSnapshot = coordinator.readSnapshot();
      if (cachedSnapshot) {
        setNow(cachedSnapshot.now);
        setRuntimeById(cachedSnapshot.runtimeById);
      }
    }
    const unsubscribeLease = coordinator.subscribeLease(setCoordination);
    const unsubscribeMessages = coordinator.subscribeMessages((message) => {
      if (
        message.type === "runtime-snapshot" &&
        message.originTabId !== currentTabId &&
        !isLeaderRef.current
      ) {
        setNow(message.snapshot.now);
        setRuntimeById(message.snapshot.runtimeById);
        return;
      }
      if (
        message.type === "runtime-rpc-response" &&
        message.targetTabId === currentTabId
      ) {
        settlePendingRuntimeRpc(
          pendingRpc,
          message.requestId,
          message.result,
          window.clearTimeout,
        );
        return;
      }
      if (message.type === "runtime-rpc-request" && isLeaderRef.current) {
        void rpcRequestHandlerRef.current?.(message);
      }
    });
    return () => {
      unsubscribeMessages();
      unsubscribeLease();
      coordinator.stop();
    };
  }, [coordinator]);

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
            activeEndpoint: null,
            identityVerified: false,
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
  const createRpcRequestId = createRuntimeRpcRequestId;

  const requestLeaderRpc = useMemo(
    () =>
      createRequestLeaderRpc({
        coordinator,
        currentTabId: coordination.currentTabId,
        createRpcRequestId,
        pendingRpc,
      }),
    [coordinator, coordination.currentTabId, createRpcRequestId],
  );
  const requestControlTakeover =
    useCallback(async (): Promise<CrossTabRuntimeLeaseState> => {
      await coordinator.requestTakeover();
      return coordinator.getLeaseState();
    }, [coordinator]);
  const { runSharedMutation } = createSharedMutationController({
    canInvokeMutation: () => {
      if (coordinator.hasCurrentLease()) {
        return null;
      }
      return takeoverRecoveryError(
        "This browser tab no longer controls the device. Take over control and retry.",
      );
    },
    currentTabId: coordination.currentTabId,
    createRpcRequestId,
    deviceMutationQueues,
    tryAcquireMutationFence: (deviceId, requestId) =>
      coordinator.tryAcquireMutationFence(deviceId, requestId),
    releaseMutationFence: (deviceId, requestId) =>
      coordinator.releaseMutationFence(deviceId, requestId),
    renewMutationFence: (deviceId, requestId) =>
      coordinator.renewMutationFence(deviceId, requestId),
    runMutationWithFence: (deviceId, requestId, invoke) =>
      coordinator.runMutationWithFence(deviceId, requestId, invoke),
    setRuntimeById,
  });
  const syncObservedPowerLock = useObservedPowerLockSync();
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
    for (const device of devices) {
      invalidateDevicePoll(device.id);
    }
    for (const [deviceId, transport] of Object.entries(
      preferredTransportByDevice.current,
    )) {
      if (transport === "local_usb") {
        delete preferredTransportByDevice.current[deviceId];
      }
    }
    setRuntimeById((prev) => resetLocalUsbRuntimeState(prev));
  }, [demoEnabled, devices, invalidateDevicePoll]);
  const requestLocalUsb = useCallback(
    async <T,>(
      deviceId: string,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<TransportDispatch<T>> => {
      const agent = await getLocalUsbAgent();
      if (!agent) {
        return {
          result: {
            ok: false,
            error: {
              kind: "offline",
              message: "Local USB service unavailable",
            },
          },
          binding: null,
          endpoint: null,
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
          result: {
            ok: false,
            error: {
              kind: "offline",
              message: "Local USB device not found",
            },
          },
          binding: null,
          endpoint: null,
        };
      }
      const timeoutMs = jsonlTimeoutMsForMethod(method, params);
      const queued = await runQueuedDeviceRequestWithAuthorization(
        localUsbRequestQueues.current,
        deviceId,
        () => getMutationDispatchAuthorizationError(method),
        async (): Promise<Result<TransportDispatch<T>>> => {
          let caughtError: unknown = null;
          let portPath = target.kind === "port_path" ? target.portPath : null;
          let binding: string | null = portPath
            ? `port:${portPath}`
            : target.kind === "devd_device"
              ? `devd:${target.deviceId}`
              : null;
          try {
            const request = {
              id: nextJsonlRequestId(),
              method,
              params,
              timeoutMs,
            };
            let response: unknown;
            if (target.kind === "devd_device") {
              const dispatched = await sendDevdLocalUsbJsonlRequestWithPortPath(
                agent,
                target.deviceId,
                request,
                () => getMutationDispatchAuthorizationError(method),
              );
              response = dispatched.response;
              portPath = dispatched.portPath;
              binding = portPath ? `port:${portPath}` : binding;
            } else {
              response = await sendLocalUsbJsonlRequest(
                agent,
                target.portPath,
                request,
                () => getMutationDispatchAuthorizationError(method),
              );
            }
            const envelope = response as JsonlEnvelope<T>;
            if (envelope?.ok && envelope.result !== undefined) {
              const result = { ok: true, value: envelope.result } as const;
              return {
                ok: true,
                value: {
                  result,
                  binding,
                  endpoint: portPath ? { kind: "local_usb", portPath } : null,
                },
              };
            }
            return {
              ok: true,
              value: {
                result: {
                  ok: false,
                  error: {
                    kind: "api_error",
                    status: 500,
                    code: envelope?.error?.code ?? "local_usb_error",
                    message:
                      envelope?.error?.message ?? "Local USB request failed",
                    retryable: envelope?.error?.retryable ?? false,
                  },
                },
                binding,
                endpoint: null,
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
                    () => getMutationDispatchAuthorizationError(method),
                  )
                : await sendLocalUsbJsonlRequest(
                    agent,
                    target.portPath,
                    request,
                    () => getMutationDispatchAuthorizationError(method),
                  ),
            method,
            params,
          );
          if (recovered) {
            return {
              ok: true,
              value: {
                result: recovered,
                binding,
                endpoint:
                  recovered.ok && portPath
                    ? { kind: "local_usb", portPath }
                    : null,
              },
            };
          }
          if (shouldResetLocalUsbConnectionCache(caughtError)) {
            localUsbAgent.current = null;
            delete localUsbPortByDevice.current[deviceId];
            if (runtimeByIdRef.current[deviceId]?.transport === "local_usb") {
              invalidateDevicePoll(deviceId);
              clearActiveEndpoint(deviceId);
            }
          }
          return {
            ok: true,
            value: {
              result: {
                ok: false,
                error: localUsbErrorToDeviceApiError(caughtError),
              },
              binding,
              endpoint: null,
            },
          };
        },
      );
      return queued.ok
        ? queued.value
        : { result: queued, binding: null, endpoint: null };
    },
    [
      clearActiveEndpoint,
      devices,
      getLocalUsbAgent,
      getMutationDispatchAuthorizationError,
      invalidateDevicePoll,
    ],
  );

  const requestTransportWithEndpoint = useCallback(
    async <T,>(
      deviceId: string,
      baseUrl: string,
      transport: DeviceTransport,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<TransportDispatch<T>> => {
      if (transport === "http") {
        const result = await runQueuedDeviceRequestWithAuthorization(
          httpRequestQueues.current,
          deviceId,
          () => getMutationDispatchAuthorizationError(method),
          () => requestHttpTransport<T>(baseUrl, method, params),
        );
        return {
          result,
          binding: baseUrl,
          endpoint:
            result.ok && baseUrl.trim()
              ? { kind: "http", url: baseUrl.trim() }
              : null,
        };
      }
      if (transport === "web_serial") {
        return requestWebSerialWithEndpoint<T>(deviceId, method, params);
      }
      return requestLocalUsb<T>(deviceId, method, params);
    },
    [
      getMutationDispatchAuthorizationError,
      requestLocalUsb,
      requestWebSerialWithEndpoint,
    ],
  );

  const requestTransport = useCallback(
    async <T,>(
      deviceId: string,
      baseUrl: string,
      transport: DeviceTransport,
      method: string,
      params?: Record<string, unknown>,
    ): Promise<Result<T>> =>
      (
        await requestTransportWithEndpoint<T>(
          deviceId,
          baseUrl,
          transport,
          method,
          params,
        )
      ).result,
    [requestTransportWithEndpoint],
  );

  const markChannelResult = useCallback(
    (deviceId: string, transport: DeviceTransport, res: Result<unknown>) => {
      markDeviceRuntimeChannel(setRuntimeById, deviceId, transport, res);
    },
    [],
  );

  const syncPowerConfigSnapshot = useCallback(
    (deviceId: string, nextConfig: PowerConfigResponse) => {
      syncDeviceRuntimePowerConfig(setRuntimeById, deviceId, nextConfig);
    },
    [],
  );

  const syncIdleBiasSnapshot = useCallback(
    (deviceId: string, nextIdleBias: IdleBiasResponse) => {
      syncDeviceRuntimeIdleBias(setRuntimeById, deviceId, nextIdleBias);
    },
    [],
  );

  const syncPdDiagnosticsSnapshot = useCallback(
    (deviceId: string, nextPdDiagnostics: PdDiagnosticsResponse) => {
      syncDeviceRuntimePdDiagnostics(
        setRuntimeById,
        deviceId,
        nextPdDiagnostics,
      );
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

  const pollDeviceRef = useRef<
    (deviceId: string, baseUrl: string) => Promise<void>
  >(() => Promise.resolve());
  const pollDevice = useCallback(
    async (deviceId: string, baseUrl: string) => {
      if (inflight.current.has(deviceId)) {
        return;
      }
      const generation = pollGeneration.current[deviceId] ?? 0;
      inflight.current.add(deviceId);
      try {
        let res: Result<PortsResponse> | null = null;
        let transport: DeviceTransport | null = null;
        let identityVerified = false;
        let infoSnapshot: DeviceInfoResponse | undefined;
        let endpointSnapshot: ActiveConnectionEndpoint | null = null;
        for (const candidate of orderedTransports(deviceId)) {
          const candidateBaseUrl =
            candidate === "http"
              ? httpBaseUrlForDevice(
                  devices.find((device) => device.id === deviceId) ?? {
                    id: deviceId,
                    name: deviceId,
                    baseUrl,
                  },
                )
              : baseUrl;
          const portsDispatch =
            await requestTransportWithEndpoint<PortsResponse>(
              deviceId,
              candidateBaseUrl,
              candidate,
              "ports.get",
            );
          const candidateRes = portsDispatch.result;
          markChannelResult(deviceId, candidate, candidateRes);
          if (candidateRes.ok) {
            res = candidateRes;
            transport = candidate;
            preferredTransportByDevice.current[deviceId] = candidate;
            const infoDispatch =
              await requestTransportWithEndpoint<DeviceInfoResponse>(
                deviceId,
                candidateBaseUrl,
                candidate,
                "info",
              );
            const infoRes = infoDispatch.result;
            identityVerified =
              infoRes.ok &&
              isDeviceInfoResponse(infoRes.value) &&
              infoRes.value.device.device_id?.trim().toLowerCase() ===
                deviceId.trim().toLowerCase();
            if (
              identityVerified &&
              infoRes.ok &&
              isDeviceInfoResponse(infoRes.value)
            ) {
              infoSnapshot = infoRes.value;
            }
            endpointSnapshot = resolvePolledActiveEndpoint({
              currentGeneration:
                (pollGeneration.current[deviceId] ?? 0) === generation,
              identityVerified,
              transportLocked: isLocalUsbSuppressedForFlashDevice(deviceId),
              portsBinding: portsDispatch.binding,
              infoBinding: infoDispatch.binding,
              portsEndpoint: portsDispatch.endpoint,
              infoEndpoint: infoDispatch.endpoint,
            });
            break;
          }
          res = candidateRes;
        }
        if (!res) {
          return;
        }
        const stalePoll =
          (pollGeneration.current[deviceId] ?? 0) !== generation;
        setRuntimeById((prev) => {
          const current = prev[deviceId];
          if (!current) {
            return prev;
          }
          if (res.ok) {
            const hub = res.value.hub
              ? {
                  ...res.value.hub,
                  capabilities:
                    res.value.hub.capabilities ?? res.value.capabilities,
                }
              : null;
            const ports = runtimePortsFromResponse(res.value);
            if (!ports) {
              return {
                ...prev,
                [deviceId]: {
                  ...current,
                  lastError: {
                    kind: "invalid_response",
                    message:
                      "missing port_a or port_c in /api/v1/ports response",
                  },
                  activeEndpoint: stalePoll ? current.activeEndpoint : null,
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
                identityVerified,
                activeEndpoint: stalePoll
                  ? current.activeEndpoint
                  : isLocalUsbSuppressedForFlashDevice(deviceId)
                    ? null
                    : endpointSnapshot,
                deviceInfo: stalePoll
                  ? current.deviceInfo
                  : (infoSnapshot ?? current.deviceInfo),
                hub,
                ports,
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
              activeEndpoint: stalePoll ? current.activeEndpoint : null,
            },
          };
        });
        if (!stalePoll && infoSnapshot && identityVerified) {
          const cache = deviceNameCacheFromInfo(infoSnapshot);
          if (cache.state !== "unknown") {
            void updateDeviceNameCache(
              deviceId,
              cache,
              infoSnapshot.device.hostname,
            );
          }
        }
      } finally {
        inflight.current.delete(deviceId);
        if ((pollGeneration.current[deviceId] ?? 0) !== generation) {
          void pollDeviceRef.current(deviceId, baseUrl);
        }
      }
    },
    [
      devices,
      markChannelResult,
      orderedTransports,
      requestTransportWithEndpoint,
      updateDeviceNameCache,
    ],
  );
  useEffect(() => {
    pollDeviceRef.current = pollDevice;
  }, [pollDevice]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    return subscribeLocalUsbDeviceLinks((link) => {
      invalidateDevicePoll(link.deviceId);
      clearActiveEndpoint(link.deviceId);
      localUsbPortByDevice.current[link.deviceId] = link.portPath;
      preferredTransportByDevice.current[link.deviceId] = "local_usb";
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [
    clearActiveEndpoint,
    devices,
    invalidateDevicePoll,
    isLeader,
    pollDevice,
  ]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    return subscribeWebSerialDeviceLinks((link) => {
      invalidateDevicePoll(link.deviceId);
      clearActiveEndpoint(link.deviceId);
      if (link.transport) {
        preferredTransportByDevice.current[link.deviceId] = "web_serial";
      } else if (
        preferredTransportByDevice.current[link.deviceId] === "web_serial"
      ) {
        delete preferredTransportByDevice.current[link.deviceId];
      }
      const device = devices.find((d) => d.id === link.deviceId);
      if (device) {
        void pollDevice(link.deviceId, httpBaseUrlForDevice(device));
      }
    });
  }, [
    clearActiveEndpoint,
    devices,
    invalidateDevicePoll,
    isLeader,
    pollDevice,
  ]);

  useEffect(() => {
    if (!isLeader) {
      return () => {};
    }
    return subscribeFlashTransportLocks((lock) => {
      if (lock.deviceId === FLASH_TRANSPORT_LOCK_ALL) {
        setRuntimeById((prev) => {
          const next = { ...prev };
          for (const [deviceId, current] of Object.entries(prev)) {
            if (current.activeEndpoint) {
              next[deviceId] = { ...current, activeEndpoint: null };
            }
          }
          return resetLocalUsbRuntimeState(next);
        });
        for (const device of devices) {
          invalidateDevicePoll(device.id);
          void pollDevice(device.id, httpBaseUrlForDevice(device));
        }
        return;
      }
      invalidateDevicePoll(lock.deviceId);
      clearActiveEndpoint(lock.deviceId);
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
  }, [
    clearActiveEndpoint,
    devices,
    invalidateDevicePoll,
    isLeader,
    pollDevice,
  ]);

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
      if (currentTransport === "http") {
        invalidateDevicePoll(link.deviceId);
        clearActiveEndpoint(link.deviceId);
      }
      if (!currentTransport) {
        preferredTransportByDevice.current[link.deviceId] = "http";
      }
      void pollDevice(link.deviceId, link.baseUrl);
    });
  }, [
    clearActiveEndpoint,
    invalidateDevicePoll,
    isLeader,
    markChannelResult,
    pollDevice,
    runtimeById,
  ]);

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
      if (coordinator.hasActiveLeader()) {
        await requestLeaderRpc("refreshDevice", [deviceId]);
        return;
      }
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }
      await pollDevice(deviceId, httpBaseUrlForDevice(device));
    },
    [coordinator, devices, pollDevice, requestLeaderRpc],
  );

  const deviceInfo = useCallback(
    async (deviceId: string): Promise<Result<DeviceInfoResponse>> => {
      if (coordinator.hasActiveLeader()) {
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
        const identityVerified =
          checked.value.device.device_id?.trim().toLowerCase() ===
          deviceId.trim().toLowerCase();
        setRuntimeById((prev) => {
          const current = prev[deviceId];
          if (
            !current ||
            (current.identityVerified === identityVerified &&
              current.deviceInfo === checked.value)
          ) {
            return prev;
          }
          return {
            ...prev,
            [deviceId]: {
              ...current,
              identityVerified,
              deviceInfo: checked.value,
            },
          };
        });
        if (identityVerified) {
          const cache = deviceNameCacheFromInfo(checked.value);
          if (cache.state !== "unknown") {
            void updateDeviceNameCache(
              deviceId,
              cache,
              checked.value.device.hostname,
            );
          }
        }
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
      coordinator,
      devices,
      markChannelResult,
      rebindHttpBaseUrl,
      requestLeaderRpc,
      requestTransport,
      runtimeById,
      updateDeviceNameCache,
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
        const authorizationError =
          getMutationDispatchAuthorizationError(method);
        if (authorizationError) {
          return {
            ok: false,
            error: authorizationError,
          };
        }
        const candidate = await requestTransport<T>(
          deviceId,
          transport === "http" ? httpBaseUrlForDevice(device) : device.baseUrl,
          transport,
          method,
          params,
        );
        const hasCurrentLease = coordinator.hasCurrentLease();
        if (RUNTIME_MUTATION_METHODS.has(method) && !hasCurrentLease) {
          const fencedResult = fenceRuntimeMutationResult(
            candidate,
            hasCurrentLease,
          );
          markChannelResult(deviceId, transport, fencedResult);
          return fencedResult;
        }
        markChannelResult(deviceId, transport, candidate);
        if (
          !candidate.ok &&
          candidate.error.kind === "busy" &&
          candidate.error.recovery === "takeover"
        ) {
          return candidate;
        }
        if (method === "identify") {
          res = candidate;
          const definitePreDispatchOffline =
            !candidate.ok &&
            candidate.error.kind === "offline" &&
            /web serial not connected|local usb service unavailable|local usb device not found|device has no active transport/i.test(
              candidate.error.message,
            );
          if (
            candidate.ok ||
            !definitePreDispatchOffline ||
            candidate.error.kind === "api_error" ||
            candidate.error.kind === "busy"
          ) {
            // Identify is side-effecting. Once a request may have reached the
            // device, never dispatch it through a fallback transport.
            break;
          }
          // Definite reachability/browser failures happened before dispatch;
          // continue to another usable transport.
          continue;
        }
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
    [
      coordinator,
      devices,
      getMutationDispatchAuthorizationError,
      markChannelResult,
      orderedTransports,
      requestTransport,
    ],
  );

  const refreshCanonicalPowerConfig = useDeviceRuntimePowerLock({
    devices,
    isLeader,
    runtimeByIdRef,
    runDeviceCommand,
    runSharedMutation,
    syncObservedPowerLock,
    syncPowerConfigSnapshot,
  });

  const {
    clearIdleBias,
    clearDeviceName,
    clearWifi,
    handleRuntimeRpcRequest,
    identify,
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
    setData,
    setDeviceName,
    setPower,
    setPowerRuntime,
    setRoute,
    wifiConfig,
  } = createDeviceRuntimeActions({
    coordinator,
    currentTabId: coordination.currentTabId,
    deviceInfo,
    devices,
    pushToast,
    requestLeaderRpc,
    refreshCanonicalPowerConfig,
    refreshDevice,
    invalidateDevicePoll,
    runDeviceCommand,
    runSharedMutation,
    runtimeByIdRef,
    setRuntimeById,
    syncIdleBiasSnapshot,
    syncObservedPowerLock,
    syncPdDiagnosticsSnapshot,
    syncPowerConfigSnapshot,
    updateDeviceNameCache,
  });
  rpcRequestHandlerRef.current = handleRuntimeRpcRequest;

  const value = useMemo<DeviceRuntimeContextValue>(() => {
    return buildDeviceRuntimeContextValue({
      now,
      devices,
      runtimeById,
      coordination,
      canControlHardware: true,
      powerLockOwner: getStablePowerLockOwner,
      requestControlTakeover,
      refreshDevice,
      deviceInfo,
      identify,
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
      setData,
      replug,
      setUsbCDownstreamRoute: setRoute,
      setDeviceName,
      clearDeviceName,
    });
  }, [
    clearWifi,
    clearDeviceName,
    coordination,
    devices,
    deviceInfo,
    identify,
    idleBias,
    now,
    pdDiagnostics,
    powerConfig,
    reboot,
    refreshDevice,
    setDeviceName,
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
    setData,
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
