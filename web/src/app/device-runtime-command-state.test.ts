import { describe, expect, test } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import { createSharedMutationController } from "./device-runtime-command-state";
import type { DeviceRuntime } from "./device-runtime-support";
import { takeoverRecoveryError } from "./device-runtime-support";

describe("createSharedMutationController", () => {
  test("blocks a queued mutation after cross-tab authority is lost", async () => {
    let runtimeById: Record<string, DeviceRuntime> = {};
    const setRuntimeById: Dispatch<
      SetStateAction<Record<string, DeviceRuntime>>
    > = (update) => {
      runtimeById = typeof update === "function" ? update(runtimeById) : update;
    };
    let invokeCalled = false;
    const { runSharedMutation } = createSharedMutationController({
      canInvokeMutation: () => takeoverRecoveryError("take over"),
      currentTabId: "tab-a",
      createRpcRequestId: () => "request-1",
      deviceMutationQueues: { current: {} },
      setRuntimeById,
    });

    const result = await runSharedMutation({
      deviceId: "device-a",
      method: "savePowerConfig",
      invoke: async () => {
        invokeCalled = true;
        return { ok: true, value: { accepted: true } };
      },
    });

    expect(result).toEqual({
      ok: false,
      error: takeoverRecoveryError("take over"),
    });
    expect(invokeCalled).toBe(false);
    expect(runtimeById).toEqual({});
  });

  test("fences a completed mutation when authority is lost before result delivery", async () => {
    let ownsLease = true;
    const { runSharedMutation } = createSharedMutationController({
      canInvokeMutation: () =>
        ownsLease ? null : takeoverRecoveryError("take over"),
      currentTabId: "tab-a",
      createRpcRequestId: () => "request-1",
      deviceMutationQueues: { current: {} },
      setRuntimeById: () => undefined,
    });

    const result = await runSharedMutation({
      deviceId: "device-a",
      method: "savePowerConfig",
      invoke: async () => {
        ownsLease = false;
        return { ok: true, value: { accepted: true } };
      },
    });

    expect(result).toEqual({
      ok: false,
      error: takeoverRecoveryError("take over"),
    });
  });
});
