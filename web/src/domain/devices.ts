export const DEVICES_STORAGE_KEY = "isolapurr_usb_hub.devices";

export type StoredDevice = {
  id: string;
  name: string;
  baseUrl: string;
  lastSeenAt?: string;
  transports?: {
    httpBaseUrl?: string;
    localUsbPortPath?: string;
    webSerialLabel?: string;
  };
};

export type AddDeviceInput = {
  name: string;
  baseUrl: string;
  id?: string;
  transports?: {
    httpBaseUrl?: string;
    localUsbPortPath?: string;
    webSerialLabel?: string;
  };
};

export type AddDeviceValidationErrors = {
  name?: string;
  baseUrl?: string;
  id?: string;
};

export type AddDeviceValidationResult =
  | { ok: true; device: StoredDevice }
  | { ok: false; errors: AddDeviceValidationErrors };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const DEVICE_ID_PATTERN = /^[0-9a-f]{12}$/;
const LEGACY_DEVICE_ID_PATTERN = /^[0-9a-f]{6}$/;

export function normalizeStoredDeviceId(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return DEVICE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function isLegacyDeviceId(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return Boolean(trimmed && LEGACY_DEVICE_ID_PATTERN.test(trimmed));
}

export function normalizeDeviceIdPrefix(
  value: string | undefined,
): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return /^[0-9a-f]{6,12}$/.test(trimmed) ? trimmed : null;
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    normalizeStoredDeviceId(
      typeof record.id === "string" ? record.id : undefined,
    ) !== null &&
    isNonEmptyString(record.name) &&
    isNonEmptyString(record.baseUrl) &&
    (record.lastSeenAt === undefined || typeof record.lastSeenAt === "string")
  );
}

function parseStoredDeviceTransports(
  value: unknown,
): StoredDevice["transports"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const transports: NonNullable<StoredDevice["transports"]> = {};
  if (typeof record.httpBaseUrl === "string") {
    const normalized = normalizeBaseUrl(record.httpBaseUrl);
    transports.httpBaseUrl = normalized.ok
      ? normalized.baseUrl
      : record.httpBaseUrl;
  }
  if (typeof record.localUsbPortPath === "string") {
    transports.localUsbPortPath = record.localUsbPortPath;
  }
  if (typeof record.webSerialLabel === "string") {
    transports.webSerialLabel = record.webSerialLabel;
  }
  return Object.keys(transports).length > 0 ? transports : undefined;
}

function normalizeAddDeviceTransports(
  value: AddDeviceInput["transports"],
): StoredDevice["transports"] {
  if (!value) {
    return undefined;
  }
  const transports: NonNullable<StoredDevice["transports"]> = {};
  if (typeof value.httpBaseUrl === "string") {
    const normalized = normalizeBaseUrl(value.httpBaseUrl);
    transports.httpBaseUrl = normalized.ok
      ? normalized.baseUrl
      : value.httpBaseUrl;
  }
  if (typeof value.localUsbPortPath === "string") {
    const portPath = value.localUsbPortPath.trim();
    if (portPath.length > 0) {
      transports.localUsbPortPath = portPath;
    }
  }
  if (typeof value.webSerialLabel === "string") {
    const label = value.webSerialLabel.trim();
    if (label.length > 0) {
      transports.webSerialLabel = label;
    }
  }
  return Object.keys(transports).length > 0 ? transports : undefined;
}

export function normalizeBaseUrl(
  raw: string,
): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Base URL is required" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Base URL must be a valid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Base URL must start with http:// or https://" };
  }

  return { ok: true, baseUrl: url.origin };
}

export function validateAddDeviceInput(
  input: AddDeviceInput,
  existingDeviceIds: Iterable<string> = [],
  existingBaseUrls: Iterable<string> = [],
): AddDeviceValidationResult {
  const errors: AddDeviceValidationErrors = {};

  const name = input.name.trim();
  if (name.length === 0) {
    errors.name = "Name is required";
  }

  const baseUrlResult = normalizeBaseUrl(input.baseUrl);
  if (!baseUrlResult.ok) {
    errors.baseUrl = baseUrlResult.error;
  }

  if (baseUrlResult.ok) {
    const existing = new Set(
      Array.from(existingBaseUrls, (v) => v.trim()).filter(Boolean),
    );
    if (existing.has(baseUrlResult.baseUrl)) {
      errors.baseUrl = "Base URL already exists";
    }
  }

  const idRaw = input.id;
  const id = idRaw === undefined ? undefined : normalizeStoredDeviceId(idRaw);
  if (idRaw !== undefined && idRaw.trim().length === 0) {
    errors.id = "ID cannot be blank";
  }

  if (idRaw !== undefined && id === null) {
    const trimmed = idRaw.trim().toLowerCase();
    if (isLegacyDeviceId(trimmed)) {
      errors.id =
        "Legacy 6-digit device_id is no longer supported. Upgrade the firmware first.";
    } else {
      errors.id = "ID must be a 12-character lowercase hex device_id";
    }
  }

  if (id) {
    const existing = new Set(existingDeviceIds);
    if (existing.has(id)) {
      errors.id = "ID already exists";
    }
  }

  if (errors.name || errors.baseUrl || errors.id) {
    return { ok: false, errors };
  }

  if (!id) {
    return {
      ok: false,
      errors: {
        id: "device_id is required",
      },
    };
  }

  return {
    ok: true,
    device: {
      id,
      name,
      baseUrl: baseUrlResult.ok ? baseUrlResult.baseUrl : input.baseUrl,
      transports: normalizeAddDeviceTransports(input.transports),
    },
  };
}

export function loadStoredDevices(): StoredDevice[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(DEVICES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(DEVICES_STORAGE_KEY);
      return [];
    }

    const devices = parsed.filter(isStoredDevice).map((d) => {
      const normalized = normalizeBaseUrl(d.baseUrl);
      return {
        ...d,
        id: normalizeStoredDeviceId(d.id) ?? d.id,
        baseUrl: normalized.ok ? normalized.baseUrl : d.baseUrl,
        transports: parseStoredDeviceTransports(d.transports),
      };
    });
    if (devices.length !== parsed.length) {
      window.localStorage.removeItem(DEVICES_STORAGE_KEY);
      return [];
    }
    return devices;
  } catch {
    window.localStorage.removeItem(DEVICES_STORAGE_KEY);
    return [];
  }
}

export function saveStoredDevices(devices: StoredDevice[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify(devices));
}
