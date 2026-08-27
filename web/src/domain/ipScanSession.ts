import type { DiscoveredDevice } from "./discovery";
import { mergeDiscoveredDevice, parseCidr } from "./discovery";

export const IP_SCAN_SESSION_VERSION = 1;
export const IP_SCAN_SESSION_TTL_MS = 10 * 60 * 1000;

export type IpScanCompletionMetrics = {
  reachableResponses: number;
  browserBlockedRequests: number;
};

export type IpScanCompletionStatus = "completed" | "browser_blocked" | "failed";

export function classifyIpScanCompletion({
  reachableResponses,
  browserBlockedRequests,
}: IpScanCompletionMetrics): IpScanCompletionStatus {
  if (reachableResponses > 0) {
    return "completed";
  }
  if (browserBlockedRequests > 0) {
    return "browser_blocked";
  }
  return "failed";
}

/**
 * A completed scan is persistable when at least one probe reached an HTTP
 * endpoint. Other hosts may legitimately be offline or blocked by browser
 * private-network policy during the same LAN sweep.
 */
export function isPersistableIpScanCompletion({
  reachableResponses,
  browserBlockedRequests,
}: IpScanCompletionMetrics): boolean {
  return (
    classifyIpScanCompletion({
      reachableResponses,
      browserBlockedRequests,
    }) === "completed"
  );
}

export type IpScanSession = {
  cidr: string;
  devices: DiscoveredDevice[];
  completedAt: number;
  expiresAt: number;
};

type StoredIpScanSession = IpScanSession & { version: number };

const LIVE_KEY = "isolapurr_usb_hub.ip_scan_session.v1.live";
const DEMO_KEY = "isolapurr_usb_hub.ip_scan_session.v1.demo";

function storageKey(demo: boolean): string {
  return demo ? DEMO_KEY : LIVE_KEY;
}

function storageFor(demo: boolean): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return demo ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseDevice(value: unknown): DiscoveredDevice | null {
  if (
    !isRecord(value) ||
    typeof value.baseUrl !== "string" ||
    !value.baseUrl.trim()
  ) {
    return null;
  }
  const firmware =
    isRecord(value.firmware) &&
    typeof value.firmware.name === "string" &&
    typeof value.firmware.version === "string"
      ? { name: value.firmware.name, version: value.firmware.version }
      : undefined;
  return {
    baseUrl: value.baseUrl,
    device_id:
      typeof value.device_id === "string" ? value.device_id : undefined,
    hostname: typeof value.hostname === "string" ? value.hostname : undefined,
    fqdn: typeof value.fqdn === "string" ? value.fqdn : undefined,
    ipv4: typeof value.ipv4 === "string" ? value.ipv4 : undefined,
    variant: typeof value.variant === "string" ? value.variant : undefined,
    firmware,
    last_seen_at:
      typeof value.last_seen_at === "string" ? value.last_seen_at : undefined,
  };
}

function parseStored(value: string | null): IpScanSession | null {
  if (!value) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(value);
    if (!isRecord(raw) || raw.version !== IP_SCAN_SESSION_VERSION) {
      return null;
    }
    if (
      typeof raw.cidr !== "string" ||
      !raw.cidr.trim() ||
      typeof raw.completedAt !== "number" ||
      !Number.isFinite(raw.completedAt) ||
      typeof raw.expiresAt !== "number" ||
      !Number.isFinite(raw.expiresAt) ||
      raw.expiresAt <= raw.completedAt ||
      raw.expiresAt - raw.completedAt > IP_SCAN_SESSION_TTL_MS
    ) {
      return null;
    }
    const parsedCidr = parseCidr(raw.cidr);
    if (!parsedCidr.ok) {
      return null;
    }
    const devices = Array.isArray(raw.devices) ? raw.devices : [];
    let deduped: DiscoveredDevice[] = [];
    for (const item of devices) {
      const device = parseDevice(item);
      if (device) {
        deduped = mergeDiscoveredDevice(deduped, device);
      }
    }
    return {
      cidr: parsedCidr.cidr,
      devices: deduped,
      completedAt: raw.completedAt,
      expiresAt: raw.expiresAt,
    };
  } catch {
    return null;
  }
}

export function createIpScanSession(
  cidr: string,
  devices: DiscoveredDevice[],
  completedAt = Date.now(),
): IpScanSession {
  let deduped: DiscoveredDevice[] = [];
  for (const device of devices) {
    deduped = mergeDiscoveredDevice(deduped, device);
  }
  const parsedCidr = parseCidr(cidr);
  return {
    cidr: parsedCidr.ok ? parsedCidr.cidr : cidr.trim(),
    devices: deduped,
    completedAt,
    expiresAt: completedAt + IP_SCAN_SESSION_TTL_MS,
  };
}

export function loadIpScanSession(
  demo: boolean,
  now = Date.now(),
): IpScanSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = storageKey(demo);
  const storage = storageFor(demo);
  if (!storage) {
    return null;
  }
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  const session = parseStored(raw);
  if (!session || session.expiresAt <= now) {
    if (raw !== null) {
      try {
        storage.removeItem(key);
      } catch {
        // Storage may be unavailable in privacy-restricted contexts.
      }
    }
    return null;
  }
  return session;
}

export function saveIpScanSession(demo: boolean, session: IpScanSession): void {
  if (typeof window === "undefined") {
    return;
  }
  const value: StoredIpScanSession = {
    version: IP_SCAN_SESSION_VERSION,
    ...session,
  };
  const storage = storageFor(demo);
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey(demo), JSON.stringify(value));
  } catch {
    // A full or restricted storage area must not make a scan fail.
  }
}

export function clearIpScanSession(demo: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  const storage = storageFor(demo);
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(storageKey(demo));
  } catch {
    // Ignore storage cleanup failures.
  }
}
