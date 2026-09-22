import type { MutableRefObject } from "react";

import type {
  CrossTabRuntimeCoordinator,
  RuntimeRpcMethod,
  RuntimeRpcResultMap,
} from "./cross-tab-runtime";
import { runtimeRpcMethodKind } from "./cross-tab-runtime";
import { crossTabRuntimeTimeoutResult } from "./device-runtime-support";

export type PendingRuntimeRpc = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

export type RuntimeRpcPendingRef = MutableRefObject<
  Record<string, PendingRuntimeRpc>
>;

export function settlePendingRuntimeRpc(
  pendingRpc: RuntimeRpcPendingRef,
  requestId: string,
  result: unknown,
  clearTimeoutFn: (timeoutId: number) => void,
): boolean {
  const pending = pendingRpc.current[requestId];
  if (!pending) {
    return false;
  }
  clearTimeoutFn(pending.timeoutId);
  delete pendingRpc.current[requestId];
  pending.resolve(result);
  return true;
}

export function runtimeRpcTimeoutMs(method: RuntimeRpcMethod): number {
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
    method === "setData" ||
    method === "replug" ||
    method === "setUsbCDownstreamRoute"
  ) {
    return 25_000;
  }
  return 8_000;
}

export function createRequestLeaderRpc({
  coordinator,
  currentTabId,
  createRpcRequestId,
  pendingRpc,
}: {
  coordinator: CrossTabRuntimeCoordinator;
  currentTabId: string;
  createRpcRequestId: () => string;
  pendingRpc: RuntimeRpcPendingRef;
}) {
  return async <TMethod extends RuntimeRpcMethod>(
    method: TMethod,
    args: unknown[],
  ): Promise<RuntimeRpcResultMap[TMethod]> => {
    const requestId = createRpcRequestId();
    return new Promise<RuntimeRpcResultMap[TMethod]>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        delete pendingRpc.current[requestId];
        resolve(
          crossTabRuntimeTimeoutResult<unknown>(
            method,
          ) as RuntimeRpcResultMap[TMethod],
        );
      }, runtimeRpcTimeoutMs(method));
      pendingRpc.current[requestId] = {
        resolve: (value) => resolve(value as RuntimeRpcResultMap[TMethod]),
        reject,
        timeoutId,
      };
      coordinator.postMessage({
        type: "runtime-rpc-request",
        originTabId: currentTabId,
        requestId,
        kind: runtimeRpcMethodKind(method),
        method,
        args,
      });
    });
  };
}
