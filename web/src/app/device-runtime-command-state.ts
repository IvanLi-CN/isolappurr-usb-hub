import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { Result } from "../domain/deviceApi";
import type { RuntimeRpcMethod } from "./cross-tab-runtime";
import {
  type DeviceRuntime,
  runQueuedDeviceRequest,
  type SharedRuntimeCommandKind,
} from "./device-runtime-support";

type UpdateRuntimeState = Dispatch<
  SetStateAction<Record<string, DeviceRuntime>>
>;

type CreateSharedMutationControllerParams = {
  currentTabId: string;
  createRpcRequestId: () => string;
  deviceMutationQueues: MutableRefObject<Record<string, Promise<void>>>;
  setRuntimeById: UpdateRuntimeState;
};

type UpdateDeviceCommandParams = {
  deviceId: string;
  setRuntimeById: UpdateRuntimeState;
};

function updateDeviceCommandState(
  { deviceId, setRuntimeById }: UpdateDeviceCommandParams,
  update: (
    current: DeviceRuntime,
  ) => Pick<DeviceRuntime, "revision" | "command"> | null,
) {
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
}

function markDeviceCommandState({
  currentTabId,
  deviceId,
  kind,
  method,
  requestId,
  setRuntimeById,
  sourceTabId,
  state,
}: {
  currentTabId: string;
  deviceId: string;
  requestId: string;
  sourceTabId?: string;
  kind: SharedRuntimeCommandKind;
  method: string;
  state: "queued" | "running";
  setRuntimeById: UpdateRuntimeState;
}) {
  updateDeviceCommandState({ deviceId, setRuntimeById }, (current) => {
    const existingCommand =
      current.command?.requestId === requestId ? current.command : null;
    return {
      revision: current.revision,
      command: {
        requestId,
        deviceId,
        sourceTabId: sourceTabId ?? currentTabId,
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
}

function finishDeviceCommandState({
  deviceId,
  errorMessage,
  incrementRevision,
  requestId,
  setRuntimeById,
  succeeded,
}: {
  deviceId: string;
  requestId: string;
  succeeded: boolean;
  incrementRevision: boolean;
  errorMessage?: string | null;
  setRuntimeById: UpdateRuntimeState;
}) {
  updateDeviceCommandState({ deviceId, setRuntimeById }, (current) => {
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
}

export function createSharedMutationController({
  currentTabId,
  createRpcRequestId,
  deviceMutationQueues,
  setRuntimeById,
}: CreateSharedMutationControllerParams) {
  const runSharedMutation = async <T>({
    deviceId,
    invoke,
    method,
    requestId = createRpcRequestId(),
    sourceTabId = currentTabId,
  }: {
    deviceId: string;
    method: RuntimeRpcMethod;
    invoke: () => Promise<Result<T>>;
    requestId?: string;
    sourceTabId?: string;
  }): Promise<Result<T>> => {
    markDeviceCommandState({
      currentTabId,
      deviceId,
      requestId,
      sourceTabId,
      kind: "mutation",
      method,
      state: "queued",
      setRuntimeById,
    });
    return runQueuedDeviceRequest(
      deviceMutationQueues.current,
      deviceId,
      async () => {
        markDeviceCommandState({
          currentTabId,
          deviceId,
          requestId,
          sourceTabId,
          kind: "mutation",
          method,
          state: "running",
          setRuntimeById,
        });
        const result = await invoke();
        finishDeviceCommandState({
          deviceId,
          requestId,
          succeeded: result.ok,
          incrementRevision: result.ok,
          errorMessage: result.ok ? null : result.error.message,
          setRuntimeById,
        });
        return result;
      },
    );
  };

  return {
    runSharedMutation,
  };
}
