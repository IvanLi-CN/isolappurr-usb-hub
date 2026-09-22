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

  test("blocks a second tab while the first device mutation is in flight", async () => {
    let fenceHeld = false;
    let releaseFirstInvoke: (() => void) | null = null;
    const createController = (tabId: string) =>
      createSharedMutationController({
        canInvokeMutation: () => null,
        currentTabId: tabId,
        createRpcRequestId: () => `${tabId}-request`,
        deviceMutationQueues: { current: {} },
        setRuntimeById: () => undefined,
        tryAcquireMutationFence: async () => {
          if (fenceHeld) {
            return false;
          }
          fenceHeld = true;
          return true;
        },
        releaseMutationFence: () => {
          fenceHeld = false;
        },
      });
    const first = createController("tab-a");
    const second = createController("tab-b");
    let firstInvokeCalled = false;
    let secondInvokeCalled = false;
    const firstResultPromise = first.runSharedMutation({
      deviceId: "device-a",
      method: "savePowerConfig",
      invoke: async () => {
        firstInvokeCalled = true;
        await new Promise<void>((resolve) => {
          releaseFirstInvoke = resolve;
        });
        return { ok: true, value: { accepted: true } };
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const secondResult = await second.runSharedMutation({
      deviceId: "device-a",
      method: "savePowerConfig",
      invoke: async () => {
        secondInvokeCalled = true;
        return { ok: true, value: { accepted: true } };
      },
    });

    expect(firstInvokeCalled).toBeTrue();
    expect(secondInvokeCalled).toBeFalse();
    expect(secondResult.ok).toBeFalse();
    if (releaseFirstInvoke) {
      releaseFirstInvoke();
    }
    await expect(firstResultPromise).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
  });
});
