import { useCallback } from "react";
import type { PowerConfigResponse } from "../domain/deviceApi";
import {
  clearPowerLockResume,
  getStablePowerLockOwner,
  markPowerLockHeld,
} from "./device-runtime-support";

export function createRuntimeRpcRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useObservedPowerLockSync() {
  return useCallback(
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
}
