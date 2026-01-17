import type { ThemeId } from "../app/theme";
import { agentFetch, type DesktopAgent } from "./desktopAgent";
import {
  type AddDeviceInput,
  normalizeBaseUrl,
  type StoredDevice,
} from "./devices";

const VALID_THEMES: ThemeId[] = ["isolapurr", "isolapurr-dark", "system"];

type StorageError = { code?: string; message: string };

type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageError };

type StorageDevicesResponse = {
  devices: StoredDevice[];
};

type StorageDeviceResponse = {
  device: StoredDevice;
};

type StorageSettingsResponse = {
  settings: { theme: ThemeId };
};

type StorageMigrateResponse = {
  migrated: boolean;
  imported?: { devices: number; settings: boolean };
  reason?: string;
};

type DesktopStorageExport = {
  schema_version: number;
  devices: StoredDevice[];
  settings: { theme?: ThemeId };
  meta?: {
    migrated_from_localstorage_at?: string;
    last_corrupt_at?: string;
    last_corrupt_reason?: string;
  };
};

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && VALID_THEMES.includes(value as ThemeId);
}

function parseStoredDevice(value: unknown): StoredDevice | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  if (typeof record.name !== "string") {
    return null;
  }
  if (typeof record.baseUrl !== "string") {
    return null;
  }
  const normalized = normalizeBaseUrl(record.baseUrl);
  return {
    id: record.id,
    name: record.name,
    baseUrl: normalized.ok ? normalized.baseUrl : record.baseUrl,
    lastSeenAt:
      typeof record.lastSeenAt === "string" ? record.lastSeenAt : undefined,
  };
}

async function readStorageError(res: Response): Promise<StorageError> {
  try {
    const json = (await res.json()) as unknown;
    if (json && typeof json === "object") {
      const obj = json as Record<string, unknown>;
      const error = obj.error as Record<string, unknown> | undefined;
      const message =
        error && typeof error.message === "string"
          ? error.message
          : `HTTP ${res.status}`;
      const code =
        error && typeof error.code === "string" ? error.code : undefined;
      return { code, message };
    }
  } catch {
    // ignore
  }
  return { message: `HTTP ${res.status}` };
}

export async function fetchStoredDevices(
  agent: DesktopAgent,
): Promise<StorageResult<StoredDevice[]>> {
  const res = await agentFetch(agent, "/api/v1/storage/devices");
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as StorageDevicesResponse | undefined;
  const devicesRaw = Array.isArray(obj?.devices) ? obj.devices : [];
  const devices = devicesRaw
    .map((d) => parseStoredDevice(d))
    .filter((d): d is StoredDevice => Boolean(d));
  return { ok: true, value: devices };
}

export async function upsertStoredDevice(
  agent: DesktopAgent,
  input: AddDeviceInput,
): Promise<StorageResult<StoredDevice>> {
  const res = await agentFetch(agent, "/api/v1/storage/devices", {
    method: "POST",
    body: JSON.stringify({ device: input }),
  });
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as StorageDeviceResponse | undefined;
  const device = obj?.device ? parseStoredDevice(obj.device) : null;
  if (!device) {
    return { ok: false, error: { message: "invalid response" } };
  }
  return { ok: true, value: device };
}

export async function deleteStoredDevice(
  agent: DesktopAgent,
  deviceId: string,
): Promise<StorageResult<boolean>> {
  const res = await agentFetch(agent, `/api/v1/storage/devices/${deviceId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  return { ok: true, value: true };
}

export async function fetchStoredTheme(
  agent: DesktopAgent,
): Promise<StorageResult<ThemeId>> {
  const res = await agentFetch(agent, "/api/v1/storage/settings");
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as StorageSettingsResponse | undefined;
  const theme = obj?.settings?.theme;
  if (!isThemeId(theme)) {
    return { ok: true, value: "isolapurr" };
  }
  return { ok: true, value: theme };
}

export async function updateStoredTheme(
  agent: DesktopAgent,
  theme: ThemeId,
): Promise<StorageResult<ThemeId>> {
  const res = await agentFetch(agent, "/api/v1/storage/settings", {
    method: "PUT",
    body: JSON.stringify({ settings: { theme } }),
  });
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as StorageSettingsResponse | undefined;
  const nextTheme = obj?.settings?.theme;
  if (!isThemeId(nextTheme)) {
    return { ok: false, error: { message: "invalid response" } };
  }
  return { ok: true, value: nextTheme };
}

export async function migrateFromLocalStorage(
  agent: DesktopAgent,
  payload: {
    devices?: StoredDevice[];
    settings?: { theme?: ThemeId };
  },
): Promise<StorageResult<StorageMigrateResponse>> {
  const res = await agentFetch(agent, "/api/v1/storage/migrate/localstorage", {
    method: "POST",
    body: JSON.stringify({
      source: "localStorage",
      devices: payload.devices,
      settings: payload.settings,
    }),
  });
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as StorageMigrateResponse | undefined;
  if (typeof obj?.migrated !== "boolean") {
    return { ok: false, error: { message: "invalid response" } };
  }
  return { ok: true, value: obj };
}

export async function exportStorage(
  agent: DesktopAgent,
): Promise<StorageResult<DesktopStorageExport>> {
  const res = await agentFetch(agent, "/api/v1/storage/export");
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  const json = (await res.json()) as unknown;
  const obj = json as DesktopStorageExport | undefined;
  if (!obj || typeof obj.schema_version !== "number") {
    return { ok: false, error: { message: "invalid response" } };
  }
  return { ok: true, value: obj };
}

export async function resetStorage(
  agent: DesktopAgent,
): Promise<StorageResult<boolean>> {
  const res = await agentFetch(agent, "/api/v1/storage/reset", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    return { ok: false, error: await readStorageError(res) };
  }
  return { ok: true, value: true };
}
