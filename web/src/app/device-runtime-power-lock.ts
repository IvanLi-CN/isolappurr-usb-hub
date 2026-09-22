import { type MutableRefObject, useCallback, useEffect } from "react";
import type { PowerConfigResponse, Result } from "../domain/deviceApi";
import type { StoredDevice } from "../domain/devices";
import {
  canResumePowerLock,
  type DeviceRuntime,
  getStablePowerLockOwner,
  markPowerLockHeld,
} from "./device-runtime-support";

type RunDeviceCommand = <T>(
  deviceId: string,
  method: string,
  params?: Record<string, unknown>,
) => Promise<Result<T>>;

type RunSharedMutation = <T>(params: {
  deviceId: string;
  method: "setPowerLock";
  invoke: () => Promise<Result<T>>;
}) => Promise<Result<T>>;

export function useDeviceRuntimePowerLock({
  devices,
  isLeader,
  runtimeByIdRef,
  runDeviceCommand,
  runSharedMutation,
  syncObservedPowerLock,
  syncPowerConfigSnapshot,
}: {
  devices: StoredDevice[];
  isLeader: boolean;
  runtimeByIdRef: MutableRefObject<Record<string, DeviceRuntime>>;
  runDeviceCommand: RunDeviceCommand;
  runSharedMutation: RunSharedMutation;
  syncObservedPowerLock: (
    deviceId: string,
    lock: PowerConfigResponse["lock"] | null | undefined,
    owner?: number,
  ) => void;
  syncPowerConfigSnapshot: (
    deviceId: string,
    nextConfig: PowerConfigResponse,
  ) => void;
}) {
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
      if (!fallback) return snapshot;
      syncObservedPowerLock(deviceId, fallback.lock, owner);
      syncPowerConfigSnapshot(deviceId, fallback);
      return { ok: true, value: fallback };
    },
    [runDeviceCommand, syncObservedPowerLock, syncPowerConfigSnapshot],
  );

  useEffect(() => {
    if (!isLeader) return () => {};
    let cancelled = false;
    const renewLocks = async () => {
      for (const device of devices) {
        const runtime = runtimeByIdRef.current[device.id];
        const lock = runtime?.powerConfig?.lock;
        const owner = getStablePowerLockOwner(device.id);
        if (!lock || lock.owner !== owner || !canResumePowerLock(device.id))
          continue;
        const renewal = await runSharedMutation({
          deviceId: device.id,
          method: "setPowerLock",
          invoke: async () => {
            const result = await runDeviceCommand<PowerConfigResponse>(
              device.id,
              "power.lock",
              { owner, acquire: true },
            );
            if (result.ok) {
              await refreshCanonicalPowerConfig(device.id, owner, result.value);
            }
            return result;
          },
        });
        if (cancelled) return;
        if (renewal.ok) {
          markPowerLockHeld(device.id);
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
  }, [
    devices,
    isLeader,
    refreshCanonicalPowerConfig,
    runDeviceCommand,
    runSharedMutation,
    runtimeByIdRef,
  ]);

  return refreshCanonicalPowerConfig;
}
