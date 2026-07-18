import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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
import type { StoredDevice } from "../domain/devices";
import type { PortId, UsbCDownstreamRoute } from "../domain/ports";
import type {
  CrossTabRuntimeCoordinator,
  RuntimeChannelMessage,
  RuntimeRpcMethod,
  RuntimeRpcResultMap,
} from "./cross-tab-runtime";
import {
  applyOptimisticPowerConfig,
  clearPowerLockResume,
  type DeviceRuntime,
  type DeviceTransport,
  getStablePowerLockOwner,
} from "./device-runtime-support";

type UpdateRuntimeState = Dispatch<
  SetStateAction<Record<string, DeviceRuntime>>
>;

type RequestLeaderRpc = <TMethod extends RuntimeRpcMethod>(
  method: TMethod,
  args: unknown[],
) => Promise<RuntimeRpcResultMap[TMethod]>;

type RunDeviceCommand = <T>(
  deviceId: string,
  method: string,
  params?: Record<string, unknown>,
  allowedTransports?: DeviceTransport[],
) => Promise<Result<T>>;

type RunSharedMutation = <T>(params: {
  deviceId: string;
  method: RuntimeRpcMethod;
  invoke: () => Promise<Result<T>>;
  requestId?: string;
  sourceTabId?: string;
}) => Promise<Result<T>>;

type SharedMutationInvocationOptions = {
  requestId?: string;
  sourceTabId?: string;
};

type PushToast = (toast: {
  id?: string;
  message: string;
  variant: "success" | "warning" | "error";
  durationMs?: number;
}) => void;

type CreateDeviceRuntimeActionsParams = {
  coordinator: CrossTabRuntimeCoordinator;
  coordinationRole: "leader" | "follower" | "unsupported";
  currentTabId: string;
  deviceInfo: (deviceId: string) => Promise<Result<DeviceInfoResponse>>;
  devices: StoredDevice[];
  isLeader: boolean;
  pushToast: PushToast;
  requestLeaderRpc: RequestLeaderRpc;
  refreshCanonicalPowerConfig: (
    deviceId: string,
    owner?: number,
    fallback?: PowerConfigResponse,
  ) => Promise<Result<PowerConfigResponse>>;
  refreshDevice: (deviceId: string) => Promise<void>;
  runDeviceCommand: RunDeviceCommand;
  runSharedMutation: RunSharedMutation;
  runtimeByIdRef: MutableRefObject<Record<string, DeviceRuntime>>;
  setRuntimeById: UpdateRuntimeState;
  syncIdleBiasSnapshot: (
    deviceId: string,
    nextIdleBias: IdleBiasResponse,
  ) => void;
  syncObservedPowerLock: (
    deviceId: string,
    lock: PowerConfigResponse["lock"] | null | undefined,
    owner?: number,
  ) => void;
  syncPdDiagnosticsSnapshot: (
    deviceId: string,
    nextPdDiagnostics: PdDiagnosticsResponse,
  ) => void;
  syncPowerConfigSnapshot: (
    deviceId: string,
    nextConfig: PowerConfigResponse,
  ) => void;
};

function invalidDeviceResult<T>(deviceId: string): Result<T> {
  return {
    ok: false,
    error: {
      kind: "invalid_response",
      message: `Unknown device: ${deviceId}`,
    },
  };
}

function setPending(
  setRuntimeById: UpdateRuntimeState,
  deviceId: string,
  portId: PortId,
  value: boolean,
) {
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
}

export function createDeviceRuntimeActions({
  coordinator,
  coordinationRole,
  currentTabId,
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
}: CreateDeviceRuntimeActionsParams) {
  const wifiConfig = async (
    deviceId: string,
  ): Promise<Result<WifiConfigResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
      return requestLeaderRpc("wifiConfig", [deviceId]);
    }
    return runDeviceCommand<WifiConfigResponse>(deviceId, "wifi.get");
  };

  const saveWifiConfig = async (
    deviceId: string,
    input: WifiConfigInput,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<WifiMutationResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const clearWifi = async (
    deviceId: string,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<WifiMutationResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const resetSettings = async (
    deviceId: string,
    scope: SettingsResetScope,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<SettingsResetResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const reboot = async (
    deviceId: string,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<RebootResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const powerConfig = async (
    deviceId: string,
  ): Promise<Result<PowerConfigResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
      return requestLeaderRpc("powerConfig", [deviceId]);
    }
    return refreshCanonicalPowerConfig(deviceId);
  };

  const pdDiagnostics = async (
    deviceId: string,
  ): Promise<Result<PdDiagnosticsResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const idleBias = async (
    deviceId: string,
  ): Promise<Result<IdleBiasResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const savePowerConfig = async (
    deviceId: string,
    input: PowerConfigInput,
    owner: number,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<PowerConfigResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const restoreDefaults = async (
    deviceId: string,
    owner: number,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<PowerConfigResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const setLock = async (
    deviceId: string,
    owner: number,
    acquire: boolean,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<PowerConfigResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
          { owner, acquire },
        );
        if (res.ok) {
          if (acquire && res.value.lock?.owner === owner) {
            syncObservedPowerLock(deviceId, res.value.lock, owner);
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
  };

  const setIdleBias = async (
    deviceId: string,
    correctionEnabled: boolean,
    owner: number,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<IdleBiasResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const runIdleBias = async (
    deviceId: string,
    owner: number,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<IdleBiasResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
          { owner },
        );
        if (res.ok) {
          syncIdleBiasSnapshot(deviceId, res.value);
        }
        return res;
      },
    });
  };

  const clearIdleBias = async (
    deviceId: string,
    owner: number,
    options?: SharedMutationInvocationOptions,
  ): Promise<Result<IdleBiasResponse>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
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
  };

  const handleApiErrorToast = (
    deviceName: string,
    label: string,
    err: DeviceApiError,
  ) => {
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
  };

  const runPendingMutation = async <T>({
    allowedTransports,
    deviceId,
    method,
    params,
    pendingPortId,
  }: {
    deviceId: string;
    pendingPortId: PortId;
    method: string;
    params?: Record<string, unknown>;
    allowedTransports?: DeviceTransport[];
  }): Promise<Result<T> | null> => {
    const device = devices.find((candidate) => candidate.id === deviceId);
    if (!device) {
      return null;
    }

    setPending(setRuntimeById, deviceId, pendingPortId, true);
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
      setPending(setRuntimeById, deviceId, pendingPortId, false);
    }
  };

  const setPower = async (
    deviceId: string,
    portId: PortId,
    enabled: boolean,
  ) => {
    const result = await setPowerResult(deviceId, portId, enabled);
    const label = portId === "port_a" ? "USB-A" : "USB-C";
    const deviceName =
      devices.find((device) => device.id === deviceId)?.name ?? deviceId;
    if (result.ok) {
      pushToast({
        message: `${deviceName}: ${label} power set`,
        variant: "success",
      });
      return;
    }
    handleApiErrorToast(deviceName, label, result.error);
  };

  const setPowerResult = async (
    deviceId: string,
    portId: PortId,
    enabled: boolean,
  ): Promise<Result<{ accepted: true }>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
      return requestLeaderRpc("setPower", [deviceId, portId, enabled]);
    }
    return runSharedMutation({
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
        return direct ?? invalidDeviceResult(deviceId);
      },
    });
  };

  const replug = async (deviceId: string, portId: PortId) => {
    const result = await replugResult(deviceId, portId);
    const label = portId === "port_a" ? "USB-A" : "USB-C";
    const deviceName =
      devices.find((device) => device.id === deviceId)?.name ?? deviceId;
    if (result.ok) {
      pushToast({
        message: `${deviceName}: ${label} replug accepted`,
        variant: "success",
      });
      return;
    }
    handleApiErrorToast(deviceName, label, result.error);
  };

  const replugResult = async (
    deviceId: string,
    portId: PortId,
  ): Promise<Result<{ accepted: true }>> => {
    if (!isLeader && coordinationRole !== "unsupported") {
      return requestLeaderRpc("replug", [deviceId, portId]);
    }
    return runSharedMutation({
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
        return direct ?? invalidDeviceResult(deviceId);
      },
    });
  };

  const setPowerRuntime = async (
    deviceId: string,
    owner: number,
    action: "output" | "discharge",
    enabled: boolean,
  ): Promise<Result<PowerConfigResponse>> => {
    const label = action === "output" ? "Power" : "TPS discharge";
    const deviceName =
      devices.find((device) => device.id === deviceId)?.name ?? deviceId;
    const result: Result<PowerConfigResponse> =
      !isLeader && coordinationRole !== "unsupported"
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
                return direct ?? invalidDeviceResult(deviceId);
              }
              return refreshCanonicalPowerConfig(deviceId, owner, direct.value);
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
  };

  const setRoute = async (deviceId: string, route: UsbCDownstreamRoute) => {
    const result = await setRouteResult(deviceId, route);
    const deviceName =
      devices.find((device) => device.id === deviceId)?.name ?? deviceId;
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
  };

  const setRouteResult = async (
    deviceId: string,
    route: UsbCDownstreamRoute,
  ): Promise<
    Result<{
      accepted: true;
      usb_c_downstream_route: UsbCDownstreamRoute;
      persisted: boolean;
    }>
  > => {
    if (!isLeader && coordinationRole !== "unsupported") {
      return requestLeaderRpc("setUsbCDownstreamRoute", [deviceId, route]);
    }
    return runSharedMutation({
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
          params: { route },
        });
        return direct ?? invalidDeviceResult(deviceId);
      },
    });
  };

  const handleRuntimeRpcRequest = async (
    message: Extract<RuntimeChannelMessage, { type: "runtime-rpc-request" }>,
  ) => {
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
          result = await setPowerRuntime(
            deviceId,
            Number(message.args[1]),
            message.args[2] as "output" | "discharge",
            Boolean(message.args[3]),
          );
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
          result = await setPowerResult(
            deviceId,
            message.args[1] as PortId,
            Boolean(message.args[2]),
          );
          break;
        case "replug":
          result = await replugResult(deviceId, message.args[1] as PortId);
          break;
        case "setUsbCDownstreamRoute":
          result = await setRouteResult(
            deviceId,
            message.args[1] as UsbCDownstreamRoute,
          );
          break;
      }
      coordinator.postMessage({
        type: "runtime-rpc-response",
        originTabId: currentTabId,
        targetTabId: message.originTabId,
        requestId: message.requestId,
        result,
      });
    } catch (err) {
      coordinator.postMessage({
        type: "runtime-rpc-response",
        originTabId: currentTabId,
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

  return {
    clearIdleBias,
    clearWifi,
    deviceInfo,
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
  };
}
