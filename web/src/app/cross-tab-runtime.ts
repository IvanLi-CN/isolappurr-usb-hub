import type {
  DeviceApiError,
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  RebootResponse,
  Result,
  SettingsResetResponse,
  WifiConfigResponse,
  WifiMutationResponse,
} from "../domain/deviceApi";
import type { UsbCDownstreamRoute } from "../domain/ports";
import type { DeviceRuntime } from "./device-runtime-support";

type LeaseRecord = {
  tabId: string;
  expiresAt: string;
  updatedAt: string;
};

export const LIVE_RUNTIME_SCOPE = "live";
export const DEMO_RUNTIME_SCOPE = "demo";

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
  | "saveWifiConfig"
  | "clearWifiConfig"
  | "resetSettings"
  | "rebootDevice"
  | "powerConfig"
  | "savePowerConfig"
  | "restorePowerDefaults"
  | "setPowerLock"
  | "setPowerRuntime"
  | "idleBias"
  | "setIdleBiasCorrection"
  | "runIdleBiasCalibration"
  | "clearIdleBiasCalibration"
  | "pdDiagnostics"
  | "setPower"
  | "replug"
  | "setUsbCDownstreamRoute";

export type RuntimeRpcKind = "query" | "mutation";

export type RuntimeRpcResultMap = {
  refreshDevice: Result<{ ok: true }>;
  deviceInfo: Result<DeviceInfoResponse>;
  wifiConfig: Result<WifiConfigResponse>;
  saveWifiConfig: Result<WifiMutationResponse>;
  clearWifiConfig: Result<WifiMutationResponse>;
  resetSettings: Result<SettingsResetResponse>;
  rebootDevice: Result<RebootResponse>;
  powerConfig: Result<PowerConfigResponse>;
  savePowerConfig: Result<PowerConfigResponse>;
  restorePowerDefaults: Result<PowerConfigResponse>;
  setPowerLock: Result<PowerConfigResponse>;
  setPowerRuntime: Result<PowerConfigResponse>;
  idleBias: Result<IdleBiasResponse>;
  pdDiagnostics: Result<PdDiagnosticsResponse>;
  setIdleBiasCorrection: Result<IdleBiasResponse>;
  runIdleBiasCalibration: Result<IdleBiasResponse>;
  clearIdleBiasCalibration: Result<IdleBiasResponse>;
  setPower: Result<{ accepted: true }>;
  replug: Result<{ accepted: true }>;
  setUsbCDownstreamRoute: Result<{
    accepted: true;
    usb_c_downstream_route: UsbCDownstreamRoute;
    persisted: boolean;
  }>;
};

type RuntimeRpcRequestMessage = {
  type: "runtime-rpc-request";
  originTabId: string;
  requestId: string;
  kind: RuntimeRpcKind;
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

const CHANNEL_NAME_PREFIX = "isolapurr.runtime.cross-tab.v1";
const LEASE_STORAGE_KEY_PREFIX = "isolapurr.runtime.leader-lease.v1";
const SNAPSHOT_STORAGE_KEY_PREFIX = "isolapurr.runtime.snapshot.v1";
const MESSAGE_STORAGE_KEY_PREFIX = "isolapurr.runtime.message.v1";
const LEASE_TTL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

const MUTATION_METHODS = new Set<RuntimeRpcMethod>([
  "saveWifiConfig",
  "clearWifiConfig",
  "resetSettings",
  "rebootDevice",
  "savePowerConfig",
  "restorePowerDefaults",
  "setPowerLock",
  "setPowerRuntime",
  "setIdleBiasCorrection",
  "runIdleBiasCalibration",
  "clearIdleBiasCalibration",
  "setPower",
  "replug",
  "setUsbCDownstreamRoute",
]);

export function runtimeRpcMethodKind(method: RuntimeRpcMethod): RuntimeRpcKind {
  return MUTATION_METHODS.has(method) ? "mutation" : "query";
}

function createTabId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scopedStorageKey(prefix: string, scopeId: string): string {
  return `${prefix}.${scopeId}`;
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
  private readonly channelName: string;
  private readonly leaseStorageKey: string;
  private readonly snapshotStorageKey: string;
  private readonly messageStorageKey: string;
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

  constructor(scopeId = LIVE_RUNTIME_SCOPE) {
    this.channelName = scopedStorageKey(CHANNEL_NAME_PREFIX, scopeId);
    this.leaseStorageKey = scopedStorageKey(LEASE_STORAGE_KEY_PREFIX, scopeId);
    this.snapshotStorageKey = scopedStorageKey(
      SNAPSHOT_STORAGE_KEY_PREFIX,
      scopeId,
    );
    this.messageStorageKey = scopedStorageKey(
      MESSAGE_STORAGE_KEY_PREFIX,
      scopeId,
    );
  }

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
      this.channel = new BroadcastChannel(this.channelName);
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
    return parseSnapshot(window.localStorage.getItem(this.snapshotStorageKey));
  }

  publishSnapshot(snapshot: SharedRuntimeSnapshot): void {
    if (
      typeof window === "undefined" ||
      typeof window.localStorage === "undefined"
    ) {
      return;
    }
    window.localStorage.setItem(
      this.snapshotStorageKey,
      JSON.stringify(snapshot),
    );
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
      this.messageStorageKey,
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
    if (event.key === this.leaseStorageKey) {
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
    if (event.key === this.snapshotStorageKey) {
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
    if (event.key === this.messageStorageKey) {
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
    return parseLeaseRecord(window.localStorage.getItem(this.leaseStorageKey));
  }

  private writeLease(): LeaseRecord {
    const record: LeaseRecord = {
      tabId: this.tabId,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + LEASE_TTL_MS).toISOString(),
    };
    window.localStorage.setItem(this.leaseStorageKey, JSON.stringify(record));
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
    window.localStorage.removeItem(this.leaseStorageKey);
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

const sharedCoordinators = new Map<string, CrossTabRuntimeCoordinator>();

export function getSharedCrossTabRuntimeCoordinator(
  scopeId = LIVE_RUNTIME_SCOPE,
): CrossTabRuntimeCoordinator {
  const existing = sharedCoordinators.get(scopeId);
  if (existing) {
    return existing;
  }
  const next = new CrossTabRuntimeCoordinator(scopeId);
  sharedCoordinators.set(scopeId, next);
  return next;
}
