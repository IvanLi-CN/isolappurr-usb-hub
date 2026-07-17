import type {
  DeviceApiError,
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  Result,
  WifiConfigResponse,
} from "../domain/deviceApi";
import type { DeviceRuntime } from "./device-runtime-support";

type LeaseRecord = {
  tabId: string;
  expiresAt: string;
  updatedAt: string;
};

export type CrossTabRuntimeLeaseState = {
  role: "leader" | "follower" | "unsupported";
  currentTabId: string;
  leaderTabId: string | null;
  leaseExpiresAt: string | null;
};

export type SharedRuntimeSnapshot = {
  at: string;
  originTabId: string;
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
};

export type RuntimeRpcMethod =
  | "refreshDevice"
  | "deviceInfo"
  | "wifiConfig"
  | "powerConfig"
  | "idleBias"
  | "pdDiagnostics";

export type RuntimeRpcResultMap = {
  refreshDevice: Result<{ ok: true }>;
  deviceInfo: Result<DeviceInfoResponse>;
  wifiConfig: Result<WifiConfigResponse>;
  powerConfig: Result<PowerConfigResponse>;
  idleBias: Result<IdleBiasResponse>;
  pdDiagnostics: Result<PdDiagnosticsResponse>;
};

type RuntimeRpcRequestMessage = {
  type: "runtime-rpc-request";
  originTabId: string;
  requestId: string;
  method: RuntimeRpcMethod;
  args: unknown[];
};

type RuntimeRpcResponseMessage = {
  type: "runtime-rpc-response";
  originTabId: string;
  targetTabId: string;
  requestId: string;
  result: { ok: true; value: unknown } | { ok: false; error: DeviceApiError };
};

type RuntimeSnapshotMessage = {
  type: "runtime-snapshot";
  originTabId: string;
  snapshot: SharedRuntimeSnapshot;
};

export type RuntimeChannelMessage =
  | RuntimeRpcRequestMessage
  | RuntimeRpcResponseMessage
  | RuntimeSnapshotMessage;

type LeaseListener = (state: CrossTabRuntimeLeaseState) => void;
type MessageListener = (message: RuntimeChannelMessage) => void;

const CHANNEL_NAME = "isolapurr.runtime.cross-tab.v1";
const LEASE_STORAGE_KEY = "isolapurr.runtime.leader-lease.v1";
const SNAPSHOT_STORAGE_KEY = "isolapurr.runtime.snapshot.v1";
const MESSAGE_STORAGE_KEY = "isolapurr.runtime.message.v1";
const LEASE_TTL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

function createTabId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseLeaseRecord(raw: string | null): LeaseRecord | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseRecord>;
    if (
      typeof parsed.tabId !== "string" ||
      parsed.tabId.length === 0 ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as LeaseRecord;
  } catch {
    return null;
  }
}

function parseSnapshot(raw: string | null): SharedRuntimeSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SharedRuntimeSnapshot>;
    if (
      typeof parsed.at !== "string" ||
      typeof parsed.originTabId !== "string" ||
      typeof parsed.now !== "number" ||
      !parsed.runtimeById ||
      typeof parsed.runtimeById !== "object"
    ) {
      return null;
    }
    return parsed as SharedRuntimeSnapshot;
  } catch {
    return null;
  }
}

function parseMessage(raw: string | null): RuntimeChannelMessage | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { payload?: RuntimeChannelMessage };
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function isLeaseExpired(record: LeaseRecord | null, now = Date.now()): boolean {
  if (!record) {
    return true;
  }
  return Date.parse(record.expiresAt) <= now;
}

export class CrossTabRuntimeCoordinator {
  private readonly tabId = createTabId();
  private readonly leaseListeners = new Set<LeaseListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private channel: BroadcastChannel | null = null;
  private heartbeatTimer: number | null = null;
  private started = false;
  private leaseState: CrossTabRuntimeLeaseState = {
    role: "unsupported",
    currentTabId: this.tabId,
    leaderTabId: null,
    leaseExpiresAt: null,
  };

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      this.setLeaseState({
        role: "unsupported",
        currentTabId: this.tabId,
        leaderTabId: null,
        leaseExpiresAt: null,
      });
      return;
    }

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.addEventListener("message", (event) => {
        this.notifyMessageListeners(event.data as RuntimeChannelMessage);
      });
    }

    window.addEventListener("storage", this.handleStorageEvent);
    window.addEventListener("pagehide", this.handlePageHide);
    window.addEventListener("beforeunload", this.handlePageHide);
    this.refreshLeaseState(true);
    this.heartbeatTimer = window.setInterval(() => {
      this.refreshLeaseState(true);
    }, HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", this.handleStorageEvent);
      window.removeEventListener("pagehide", this.handlePageHide);
      window.removeEventListener("beforeunload", this.handlePageHide);
      if (this.heartbeatTimer !== null) {
        window.clearInterval(this.heartbeatTimer);
      }
    }
    this.heartbeatTimer = null;
    this.channel?.close();
    this.channel = null;
  }

  getTabId(): string {
    return this.tabId;
  }

  getLeaseState(): CrossTabRuntimeLeaseState {
    return this.leaseState;
  }

  subscribeLease(listener: LeaseListener): () => void {
    this.leaseListeners.add(listener);
    listener(this.leaseState);
    return () => {
      this.leaseListeners.delete(listener);
    };
  }

  subscribeMessages(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  readSnapshot(): SharedRuntimeSnapshot | null {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return null;
    }
    return parseSnapshot(window.localStorage.getItem(SNAPSHOT_STORAGE_KEY));
  }

  publishSnapshot(snapshot: SharedRuntimeSnapshot): void {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    this.postMessage({
      type: "runtime-snapshot",
      originTabId: this.tabId,
      snapshot,
    });
  }

  postMessage(message: RuntimeChannelMessage): void {
    if (this.channel) {
      this.channel.postMessage(message);
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    window.localStorage.setItem(
      MESSAGE_STORAGE_KEY,
      JSON.stringify({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        payload: message,
      }),
    );
  }

  requestTakeover(): void {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    this.writeLease();
    this.refreshLeaseState();
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key === LEASE_STORAGE_KEY) {
      const lease = parseLeaseRecord(event.newValue);
      if (lease && !isLeaseExpired(lease) && lease.tabId === this.tabId) {
        this.setLeaseState({
          role: "leader",
          currentTabId: this.tabId,
          leaderTabId: lease.tabId,
          leaseExpiresAt: lease.expiresAt,
        });
        return;
      }
      this.refreshLeaseState(true);
      return;
    }
    if (event.key === SNAPSHOT_STORAGE_KEY) {
      const snapshot = parseSnapshot(event.newValue);
      if (!snapshot || snapshot.originTabId === this.tabId) {
        return;
      }
      this.notifyMessageListeners({
        type: "runtime-snapshot",
        originTabId: snapshot.originTabId,
        snapshot,
      });
      return;
    }
    if (event.key === MESSAGE_STORAGE_KEY) {
      const message = parseMessage(event.newValue);
      if (!message || message.originTabId === this.tabId) {
        return;
      }
      this.notifyMessageListeners(message);
    }
  };

  private readonly handlePageHide = () => {
    this.releaseLeaseIfLeader();
  };

  private readLease(): LeaseRecord | null {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return null;
    }
    return parseLeaseRecord(window.localStorage.getItem(LEASE_STORAGE_KEY));
  }

  private writeLease(): LeaseRecord {
    const record: LeaseRecord = {
      tabId: this.tabId,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
    };
    window.localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  private releaseLeaseIfLeader(): void {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    const lease = this.readLease();
    if (!lease || lease.tabId !== this.tabId) {
      return;
    }
    window.localStorage.removeItem(LEASE_STORAGE_KEY);
    this.setLeaseState({
      role: "follower",
      currentTabId: this.tabId,
      leaderTabId: null,
      leaseExpiresAt: null,
    });
  }

  private refreshLeaseState(preferAcquire = false): void {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      this.setLeaseState({
        role: "unsupported",
        currentTabId: this.tabId,
        leaderTabId: null,
        leaseExpiresAt: null,
      });
      return;
    }

    let lease = this.readLease();
    if (
      preferAcquire &&
      (isLeaseExpired(lease) || lease?.tabId === this.tabId)
    ) {
      lease = this.writeLease();
    }

    if (lease && !isLeaseExpired(lease)) {
      this.setLeaseState({
        role: lease.tabId === this.tabId ? "leader" : "follower",
        currentTabId: this.tabId,
        leaderTabId: lease.tabId,
        leaseExpiresAt: lease.expiresAt,
      });
      return;
    }

    if (preferAcquire) {
      const nextLease = this.writeLease();
      this.setLeaseState({
        role: "leader",
        currentTabId: this.tabId,
        leaderTabId: nextLease.tabId,
        leaseExpiresAt: nextLease.expiresAt,
      });
      return;
    }

    this.setLeaseState({
      role: "follower",
      currentTabId: this.tabId,
      leaderTabId: null,
      leaseExpiresAt: null,
    });
  }

  private notifyMessageListeners(message: RuntimeChannelMessage): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private setLeaseState(next: CrossTabRuntimeLeaseState): void {
    const changed =
      this.leaseState.role !== next.role ||
      this.leaseState.leaderTabId !== next.leaderTabId ||
      this.leaseState.leaseExpiresAt !== next.leaseExpiresAt;
    this.leaseState = next;
    if (!changed) {
      return;
    }
    for (const listener of this.leaseListeners) {
      listener(next);
    }
  }
}

let sharedCoordinator: CrossTabRuntimeCoordinator | null = null;

export function getSharedCrossTabRuntimeCoordinator(): CrossTabRuntimeCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new CrossTabRuntimeCoordinator();
  }
  return sharedCoordinator;
}
