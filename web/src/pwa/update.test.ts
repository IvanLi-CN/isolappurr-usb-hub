import { describe, expect, test } from "bun:test";

import {
  createPwaUpdateCandidateStore,
  createPwaUpdateScheduler,
} from "./update";

class MockSessionStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MockDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

class MockWindow extends EventTarget {
  online = true;
  readonly document = new MockDocument();
  readonly sessionStorage = new MockSessionStorage();
  intervalCallback: (() => void) | null = null;

  setInterval(callback: () => void) {
    this.intervalCallback = callback;
    return 1;
  }

  clearInterval() {
    this.intervalCallback = null;
  }
}

function okResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript",
    },
  });
}

describe("createPwaUpdateCandidateStore", () => {
  test("suppresses the same candidate only for the current tab session", () => {
    const storage = new MockSessionStorage();
    const store = createPwaUpdateCandidateStore(storage);

    expect(store.shouldPrompt("sw-a")).toBe(true);
    store.dismiss("sw-a");
    expect(store.shouldPrompt("sw-a")).toBe(false);
    expect(store.shouldPrompt("sw-b")).toBe(true);
  });
});

describe("createPwaUpdateScheduler", () => {
  test("checks on startup and only updates again after the service worker changes", async () => {
    const target = new MockWindow();
    let now = 0;
    let swBody = "const version = 'v1';";
    let updateCalls = 0;

    const scheduler = createPwaUpdateScheduler({
      document: target.document as unknown as Document,
      fetchImpl: async () => okResponse(swBody),
      intervalMs: 60_000,
      now: () => now,
      registration: {
        update: async () => {
          updateCalls += 1;
        },
      },
      swUrl: "/sw.js",
      window: target as unknown as Window,
    });

    await scheduler.flush();
    expect(updateCalls).toBe(1);

    now += 61_000;
    await scheduler.checkNow("visibility");
    expect(updateCalls).toBe(1);

    swBody = "const version = 'v2';";
    now += 61_000;
    await scheduler.checkNow("visibility");
    expect(updateCalls).toBe(2);
  });

  test("skips hidden and offline checks until the page is visible and back online", async () => {
    const target = new MockWindow();
    target.document.visibilityState = "hidden";
    const reasons: string[] = [];

    const scheduler = createPwaUpdateScheduler({
      document: target.document as unknown as Document,
      fetchImpl: async () => okResponse("const version = 'v1';"),
      intervalMs: 60_000,
      now: () => 0,
      onCheck: (reason) => reasons.push(reason),
      registration: {
        update: async () => undefined,
      },
      swUrl: "/sw.js",
      window: target as unknown as Window,
    });

    await scheduler.flush();
    expect(reasons).toEqual([]);

    target.document.visibilityState = "visible";
    target.online = false;
    await scheduler.checkNow("online");
    expect(reasons).toEqual([]);

    target.online = true;
    await scheduler.checkNow("online");
    expect(reasons).toEqual(["online"]);
  });
});
