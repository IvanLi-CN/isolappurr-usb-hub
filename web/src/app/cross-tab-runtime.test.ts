import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  CrossTabRuntimeCoordinator,
  DEMO_RUNTIME_SCOPE,
  LIVE_RUNTIME_SCOPE,
  runtimeRpcMethodKind,
} from "./cross-tab-runtime";

type StorageListener = (event: StorageEvent) => void;
type WindowListener = (event: Event) => void;

function installMockWindow() {
  const store = new Map<string, string>();
  const storageListeners = new Set<StorageListener>();
  const pagehideListeners = new Set<WindowListener>();
  const beforeUnloadListeners = new Set<WindowListener>();

  const listenersFor = (type: string) => {
    if (type === "storage") {
      return storageListeners;
    }
    if (type === "pagehide") {
      return pagehideListeners;
    }
    if (type === "beforeunload") {
      return beforeUnloadListeners;
    }
    return null;
  };

  const localStorage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      const oldValue = store.get(key) ?? null;
      store.set(key, value);
      const event = { key, oldValue, newValue: value } as StorageEvent;
      for (const listener of storageListeners) {
        listener(event);
      }
    },
    setItemSilently(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      const oldValue = store.get(key) ?? null;
      store.delete(key);
      const event = { key, oldValue, newValue: null } as StorageEvent;
      for (const listener of storageListeners) {
        listener(event);
      }
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      addEventListener: (type: string, listener: StorageListener) => {
        const listeners = listenersFor(type);
        listeners?.add(listener as never);
      },
      removeEventListener: (type: string, listener: StorageListener) => {
        const listeners = listenersFor(type);
        listeners?.delete(listener as never);
      },
      dispatchEvent: (event: Event) => {
        const listeners = listenersFor(event.type);
        if (!listeners) {
          return true;
        }
        for (const listener of listeners) {
          listener(event as never);
        }
        return true;
      },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    },
  });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request: async <T>(
          _name: string,
          _options: { mode: "exclusive" },
          callback: () => Promise<T>,
        ) => callback(),
      },
    },
  });
}

describe("CrossTabRuntimeCoordinator", () => {
  beforeEach(() => {
    installMockWindow();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    Reflect.deleteProperty(globalThis, "navigator");
  });

  test("elects one leader and keeps later tabs as followers", async () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(leader.getLeaseState().role).toBe("leader");

    const follower = new CrossTabRuntimeCoordinator();
    follower.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(follower.getLeaseState().role).toBe("follower");
    expect(follower.getLeaseState().leaderTabId).toBe(
      leader.getLeaseState().leaderTabId,
    );
  });

  test("supports explicit takeover after the previous lease expires", async () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const follower = new CrossTabRuntimeCoordinator();
    follower.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (
      window.localStorage as Storage & {
        setItemSilently: (key: string, value: string) => void;
      }
    ).setItemSilently(
      "isolapurr.runtime.leader-lease.v1.live",
      JSON.stringify({
        tabId: leader.getTabId(),
        expiresAt: new Date(Date.now() - 1).toISOString(),
        updatedAt: new Date(Date.now() - 2).toISOString(),
      }),
    );
    await follower.requestTakeover();

    expect(follower.getLeaseState().role).toBe("leader");
    expect(leader.getLeaseState().role).toBe("follower");
    expect(leader.getLeaseState().leaderTabId).toBe(
      follower.getLeaseState().leaderTabId,
    );
  });

  test("elects one winner when two expired followers request takeover together", async () => {
    const initialLeader = new CrossTabRuntimeCoordinator();
    initialLeader.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = new CrossTabRuntimeCoordinator();
    first.start();
    const second = new CrossTabRuntimeCoordinator();
    second.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (
      window.localStorage as Storage & {
        setItemSilently: (key: string, value: string) => void;
      }
    ).setItemSilently(
      "isolapurr.runtime.leader-lease.v1.live",
      JSON.stringify({
        tabId: initialLeader.getTabId(),
        expiresAt: new Date(Date.now() - 1).toISOString(),
        updatedAt: new Date(Date.now() - 2).toISOString(),
      }),
    );

    await Promise.all([first.requestTakeover(), second.requestTakeover()]);

    expect(
      [first.getLeaseState().role, second.getLeaseState().role].filter(
        (role) => role === "leader",
      ),
    ).toHaveLength(1);
    expect(
      [first.getLeaseState().role, second.getLeaseState().role].filter(
        (role) => role === "follower",
      ),
    ).toHaveLength(1);
  });

  test("classifies runtime RPC methods into query and mutation kinds", () => {
    expect(runtimeRpcMethodKind("deviceInfo")).toBe("query");
    expect(runtimeRpcMethodKind("savePowerConfig")).toBe("mutation");
    expect(runtimeRpcMethodKind("setData")).toBe("mutation");
  });

  test("broadcasts shared runtime snapshots through storage fallback", () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();

    const follower = new CrossTabRuntimeCoordinator();
    follower.start();

    let seenSnapshotOrigin: string | null = null;
    const unsubscribe = follower.subscribeMessages((message) => {
      if (message.type === "runtime-snapshot") {
        seenSnapshotOrigin = message.originTabId;
      }
    });

    leader.publishSnapshot({
      at: new Date().toISOString(),
      originTabId: leader.getTabId(),
      now: 1_234,
      runtimeById: {},
    });

    expect(seenSnapshotOrigin).toBe(leader.getTabId());
    unsubscribe();
  });

  test("does not loop its own snapshot back through storage fallback", () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();

    let seenSnapshots = 0;
    const unsubscribe = leader.subscribeMessages((message) => {
      if (message.type === "runtime-snapshot") {
        seenSnapshots += 1;
      }
    });

    leader.publishSnapshot({
      at: new Date().toISOString(),
      originTabId: leader.getTabId(),
      now: 1_234,
      runtimeById: {},
    });

    expect(seenSnapshots).toBe(0);
    unsubscribe();
  });

  test("forwards runtime rpc requests and responses through storage fallback", () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();

    const secondaryTab = new CrossTabRuntimeCoordinator();
    secondaryTab.start();

    let requestSeen = false;
    let responseSeen = false;

    const unsubscribeLeader = leader.subscribeMessages((message) => {
      if (
        message.type === "runtime-rpc-request" &&
        message.requestId === "req-1"
      ) {
        requestSeen = true;
      }
    });
    const unsubscribeSecondary = secondaryTab.subscribeMessages((message) => {
      if (
        message.type === "runtime-rpc-response" &&
        message.requestId === "req-1"
      ) {
        responseSeen = true;
      }
    });

    secondaryTab.postMessage({
      type: "runtime-rpc-request",
      originTabId: secondaryTab.getTabId(),
      requestId: "req-1",
      kind: "mutation",
      method: "savePowerConfig",
      args: ["device-a", { capability: { power_watts: 65 } }, 7],
    });
    leader.postMessage({
      type: "runtime-rpc-response",
      originTabId: leader.getTabId(),
      targetTabId: secondaryTab.getTabId(),
      requestId: "req-1",
      result: {
        ok: true,
        value: {
          ok: true,
          value: { hardware: "sw2303" },
        },
      },
    });

    expect(requestSeen).toBe(true);
    expect(responseSeen).toBe(true);
    unsubscribeLeader();
    unsubscribeSecondary();
  });

  test("isolates demo and live runtime scopes", async () => {
    const liveLeader = new CrossTabRuntimeCoordinator(LIVE_RUNTIME_SCOPE);
    liveLeader.start();

    const demoLeader = new CrossTabRuntimeCoordinator(DEMO_RUNTIME_SCOPE);
    demoLeader.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(liveLeader.getLeaseState().role).toBe("leader");
    expect(demoLeader.getLeaseState().role).toBe("leader");
    expect(liveLeader.getLeaseState().leaderTabId).not.toBe(
      demoLeader.getLeaseState().leaderTabId,
    );

    let liveSawDemoSnapshot = false;
    const unsubscribe = liveLeader.subscribeMessages((message) => {
      if (message.type === "runtime-snapshot") {
        liveSawDemoSnapshot = true;
      }
    });

    demoLeader.publishSnapshot({
      at: new Date().toISOString(),
      originTabId: demoLeader.getTabId(),
      now: 1_234,
      runtimeById: {
        aabbcc001122: {
          lastOkAt: null,
          lastError: null,
          transport: null,
          channels: {
            http: { lastOkAt: null, lastError: null },
            web_serial: { lastOkAt: null, lastError: null },
            local_usb: { lastOkAt: null, lastError: null },
          },
          hub: null,
          ports: null,
          pending: { port_a: false, port_c: false },
          powerConfig: null,
          idleBias: null,
          pdDiagnostics: null,
          revision: 0,
          command: null,
        },
      },
    });

    expect(liveSawDemoSnapshot).toBe(false);
    expect(liveLeader.readSnapshot()).toBeNull();
    expect(demoLeader.readSnapshot()?.runtimeById.aabbcc001122).toBeDefined();
    unsubscribe();
  });
});
