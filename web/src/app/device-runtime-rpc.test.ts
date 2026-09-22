import { afterEach, describe, expect, test } from "bun:test";

import type { CrossTabRuntimeCoordinator } from "./cross-tab-runtime";
import {
  createRequestLeaderRpc,
  settlePendingRuntimeRpc,
} from "./device-runtime-rpc";

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("createRequestLeaderRpc", () => {
  test("settles a normal response and clears its timeout", () => {
    const resolved: unknown[] = [];
    const pendingRpc = {
      current: {
        "request-1": {
          resolve: (value: unknown) => resolved.push(value),
          reject: () => undefined,
          timeoutId: 42,
        },
      },
    };
    const cleared: number[] = [];

    expect(
      settlePendingRuntimeRpc(
        pendingRpc,
        "request-1",
        { ok: true, value: "done" },
        (timeoutId) => cleared.push(timeoutId),
      ),
    ).toBeTrue();
    expect(cleared).toEqual([42]);
    expect(resolved).toEqual([{ ok: true, value: "done" }]);
    expect(pendingRpc.current).toEqual({});
  });

  test("resolves a timeout Result and removes the pending request", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout: (callback: () => void) => {
          queueMicrotask(callback);
          return 1;
        },
        clearTimeout: () => undefined,
      },
    });
    const pendingRpc = {
      current: {},
    };
    const messages: unknown[] = [];
    const coordinator = {
      postMessage: (message: unknown) => messages.push(message),
    } as unknown as CrossTabRuntimeCoordinator;
    const requestLeaderRpc = createRequestLeaderRpc({
      coordinator,
      currentTabId: "tab-b",
      createRpcRequestId: () => "request-1",
      pendingRpc,
    });

    await expect(
      requestLeaderRpc("savePowerConfig", ["device-a"]),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: "busy",
        message:
          "The active browser tab did not confirm savePowerConfig. Take over control and retry.",
        retryable: true,
        recovery: "takeover",
      },
    });
    expect(pendingRpc.current).toEqual({});
    expect(messages).toHaveLength(1);
  });
});
