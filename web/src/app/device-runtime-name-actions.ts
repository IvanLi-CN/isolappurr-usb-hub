import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DeviceNameMutationResponse, Result } from "../domain/deviceApi";
import {
  type DeviceNameCache,
  resolveStoredDeviceDisplayName,
} from "../domain/deviceName";
import type { StoredDevice } from "../domain/devices";
import type {
  CrossTabRuntimeCoordinator,
  RuntimeRpcMethod,
  RuntimeRpcResultMap,
} from "./cross-tab-runtime";
import type { DeviceRuntime, DeviceTransport } from "./device-runtime-support";

type Options = { requestId?: string; sourceTabId?: string };
type RequestLeaderRpc = <TMethod extends RuntimeRpcMethod>(
  method: TMethod,
  args: unknown[],
) => Promise<RuntimeRpcResultMap[TMethod]>;
type RunCommand = <T>(
  deviceId: string,
  method: string,
  params?: Record<string, unknown>,
  transports?: DeviceTransport[],
) => Promise<Result<T>>;
type SharedMutation = <T>(params: {
  deviceId: string;
  method: RuntimeRpcMethod;
  invoke: () => Promise<Result<T>>;
  requestId?: string;
  sourceTabId?: string;
}) => Promise<Result<T>>;

export function createDeviceNameActions(params: {
  coordinator: CrossTabRuntimeCoordinator;
  devices: StoredDevice[];
  runtimeByIdRef: MutableRefObject<Record<string, DeviceRuntime>>;
  setRuntimeById: Dispatch<SetStateAction<Record<string, DeviceRuntime>>>;
  isLeader: boolean;
  coordinationRole: "leader" | "follower" | "unsupported";
  requestLeaderRpc: RequestLeaderRpc;
  runDeviceCommand: RunCommand;
  runSharedMutation: SharedMutation;
  refreshDevice: (deviceId: string) => Promise<void>;
  invalidateDevicePoll?: (deviceId: string) => void;
  updateDeviceNameCache?: (
    deviceId: string,
    cache: DeviceNameCache,
    hostname?: string,
  ) => Promise<void>;
}) {
  const applySnapshot = (
    deviceId: string,
    response: DeviceNameMutationResponse,
  ) => {
    const cache: DeviceNameCache =
      response.display_name === null
        ? { state: "unset" }
        : { state: "value", value: response.display_name };
    const current = params.runtimeByIdRef.current[deviceId];
    params.setRuntimeById((prev) => {
      const runtime = prev[deviceId];
      if (!runtime?.deviceInfo) return prev;
      return {
        ...prev,
        [deviceId]: {
          ...runtime,
          deviceInfo: {
            ...runtime.deviceInfo,
            device: {
              ...runtime.deviceInfo.device,
              display_name: response.display_name,
            },
          },
        },
      };
    });
    if (params.updateDeviceNameCache) {
      void params.updateDeviceNameCache(
        deviceId,
        cache,
        current?.deviceInfo?.device.hostname,
      );
    }
  };

  const displayNameFor = (deviceId: string): string => {
    const device = params.devices.find(
      (candidate) => candidate.id === deviceId,
    );
    if (!device) return deviceId;
    const runtime = params.runtimeByIdRef.current[deviceId];
    return resolveStoredDeviceDisplayName(
      device,
      runtime?.identityVerified ? (runtime.deviceInfo ?? null) : null,
    );
  };

  const mutate = async (
    deviceId: string,
    method: "setDeviceName" | "clearDeviceName",
    invokeMethod: "settings.name.set" | "settings.name.clear",
    paramsValue: Record<string, unknown> | undefined,
    options?: Options,
  ): Promise<Result<DeviceNameMutationResponse>> => {
    if (!params.isLeader && params.coordinationRole !== "unsupported") {
      return params.requestLeaderRpc(method, [
        deviceId,
        ...(paramsValue ? [paramsValue.name] : []),
      ]);
    }
    params.invalidateDevicePoll?.(deviceId);
    return params.runSharedMutation({
      deviceId,
      method,
      requestId: options?.requestId,
      sourceTabId: options?.sourceTabId,
      invoke: async () => {
        const response =
          await params.runDeviceCommand<DeviceNameMutationResponse>(
            deviceId,
            invokeMethod,
            paramsValue,
          );
        if (response.ok) {
          applySnapshot(deviceId, response.value);
          await params.refreshDevice(deviceId);
        }
        return response;
      },
    });
  };

  return {
    displayNameFor,
    setDeviceName: (deviceId: string, name: string, options?: Options) =>
      mutate(
        deviceId,
        "setDeviceName",
        "settings.name.set",
        { name: name.trim() },
        options,
      ),
    clearDeviceName: (deviceId: string, options?: Options) =>
      mutate(
        deviceId,
        "clearDeviceName",
        "settings.name.clear",
        undefined,
        options,
      ),
  };
}
