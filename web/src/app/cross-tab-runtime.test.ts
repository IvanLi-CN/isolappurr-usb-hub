import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { CrossTabRuntimeCoordinator } from "./cross-tab-runtime";

type StorageListener = (event: StorageEvent) => void;

function installMockWindow() {
  const store = new Map<string, string>();
  const storageListeners = new Set<StorageListener>();

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
        if (type === "storage") {
          storageListeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: StorageListener) => {
        if (type === "storage") {
          storageListeners.delete(listener);
        }
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
}

describe("CrossTabRuntimeCoordinator", () => {
  beforeEach(() => {
    installMockWindow();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  });

  test("elects one leader and keeps later tabs as followers", () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();
    expect(leader.getLeaseState().role).toBe("leader");

    const follower = new CrossTabRuntimeCoordinator();
    follower.start();
    expect(follower.getLeaseState().role).toBe("follower");
    expect(follower.getLeaseState().leaderTabId).toBe(
      leader.getLeaseState().leaderTabId,
    );
  });

  test("supports explicit takeover by a follower tab", () => {
    const leader = new CrossTabRuntimeCoordinator();
    leader.start();

    const follower = new CrossTabRuntimeCoordinator();
    follower.start();
    follower.requestTakeover();

    expect(follower.getLeaseState().role).toBe("leader");
    expect(leader.getLeaseState().role).toBe("follower");
    expect(leader.getLeaseState().leaderTabId).toBe(
      follower.getLeaseState().leaderTabId,
    );
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
});
