import { agentFetch, type DesktopAgent } from "./desktopAgent";
import type {
  BundledFirmwareAsset,
  BundledFirmwareRelease,
} from "./firmwareBundle";

export type JsonlRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
};

export type SerialPortInfo = {
  path: string;
  label: string;
  vendorId?: number | null;
  productId?: number | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  probeInfo?: unknown;
};

const ESPRESSIF_USB_VENDOR_ID = 0x303a;
const ESP32_USB_SERIAL_JTAG_PRODUCT_ID = 0x1001;
export const DEFAULT_LOCAL_USB_FLASH_ADDRESS = 0x10000;
const DEFAULT_JSONL_TIMEOUT_MS = 5_000;
const LOCAL_USB_BUSY_RETRIES = 5;
let jsonlRequestSeq = 1;
const localUsbRequestQueues: Record<string, Promise<void>> = {};

function shouldFallbackToLegacySerialApi(status: number): boolean {
  return status === 404 || status === 405;
}

function isUsableLocalUsbJson(value: unknown): boolean {
  return Boolean(value && typeof value === "object");
}

export class LocalUsbAgentHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    code = "local_usb_error",
    retryable = false,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export type HardwareTransportKind = "web_serial" | "local_usb";

export type DeviceIdentityExpectation = {
  deviceId?: string | null;
  mac?: string | null;
};

export type FirmwareFlashProgress = {
  stage: "connecting" | "writing" | "done";
  message: string;
  written?: number;
  total?: number;
};

export type HardwareBoardInfo = {
  source: "esptool-js" | "espflash";
  chipType?: string;
  mcuModel?: string;
  chipRevision?: string;
  flashSize?: string;
  ramSize?: string;
  psramSize?: string;
  macAddress?: string;
  crystalFrequency?: string;
  features?: string[];
  rawOutput?: string;
};

export type SerialLikePort = SerialPort & {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number; usbProductId?: number };
};

type EsptoolLoaderWithInternals = {
  ESP_MEM_END: number;
  _appendArray(left: Uint8Array, right: Uint8Array): Uint8Array;
  _intToByteArray(value: number): Uint8Array;
  checkCommand(
    opDescription: string,
    op: number,
    data: Uint8Array,
    checksum?: number,
    responseDataLength?: number,
    timeout?: number,
  ): Promise<unknown>;
  memFinish(entrypoint: number): Promise<void>;
};

type EsptoolTransportWithSignals = {
  setDTR(state: boolean): Promise<void>;
  setRTS(state: boolean): Promise<void>;
};

declare global {
  type SerialPort = {
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
  };

  interface Navigator {
    serial: {
      getPorts?: () => Promise<SerialPort[]>;
      requestPort(options?: unknown): Promise<SerialPort>;
    };
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

function sameWebSerialUsbInfo(
  left: { usbVendorId?: number; usbProductId?: number } | undefined,
  right: { usbVendorId?: number; usbProductId?: number } | undefined,
): boolean {
  return (
    left?.usbVendorId !== undefined &&
    left?.usbProductId !== undefined &&
    left.usbVendorId === right?.usbVendorId &&
    left.usbProductId === right?.usbProductId
  );
}

function resolveGrantedWebSerialPort(
  granted: SerialLikePort[],
  preferred?: SerialLikePort | null,
): SerialLikePort | null {
  if (granted.length === 0) {
    return null;
  }
  if (preferred) {
    const sameObject = granted.find((port) => port === preferred);
    if (sameObject) {
      return sameObject;
    }
  }
  if (granted.length === 1) {
    return granted[0] ?? null;
  }
  const preferredInfo = preferred?.getInfo?.();
  if (preferredInfo) {
    const matches = granted.filter((port) =>
      sameWebSerialUsbInfo(port.getInfo?.(), preferredInfo),
    );
    if (matches.length === 1) {
      return matches[0] ?? null;
    }
  }
  return null;
}

export async function refreshGrantedWebSerialPort(
  preferred?: SerialLikePort | null,
): Promise<SerialLikePort> {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial is not supported by this browser");
  }
  if (!navigator.serial.getPorts) {
    if (preferred) {
      return preferred;
    }
    throw new Error(
      "No browser-authorized Web USB device is available. Re-open Web USB and choose the exact ESP32-S3 target.",
    );
  }

  let sawGrantedPorts = false;
  let sawAmbiguousPorts = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const granted = (await navigator.serial.getPorts()) as SerialLikePort[];
    if (granted.length > 0) {
      sawGrantedPorts = true;
    }
    let resolved: SerialLikePort | null = null;
    if (preferred) {
      const refreshedMatches = granted.filter((port) => {
        if (port === preferred) {
          return false;
        }
        return sameWebSerialUsbInfo(
          typeof preferred.getInfo === "function"
            ? preferred.getInfo()
            : undefined,
          typeof port.getInfo === "function" ? port.getInfo() : undefined,
        );
      });
      if (refreshedMatches.length === 1) {
        return refreshedMatches[0] ?? null;
      }
      if (refreshedMatches.length > 1) {
        sawAmbiguousPorts = true;
      }
      if (!granted.some((port) => port === preferred)) {
        resolved = resolveGrantedWebSerialPort(granted);
      } else if (granted.length > 1) {
        sawAmbiguousPorts = true;
      }
    } else {
      resolved = resolveGrantedWebSerialPort(granted);
    }
    if (resolved) {
      return resolved;
    }
    await delay(120 * (attempt + 1));
  }

  if (sawAmbiguousPorts) {
    throw new Error(
      "Browser granted Web USB ports are ambiguous or unavailable. Re-open Web USB and choose the exact ESP32-S3 target again.",
    );
  }
  if (sawGrantedPorts && preferred) {
    return preferred;
  }
  throw new Error(
    "Browser granted Web USB ports are ambiguous or unavailable. Re-open Web USB and choose the exact ESP32-S3 target again.",
  );
}

function inferRamSize(chipType: string | undefined): string | undefined {
  if (!chipType) {
    return undefined;
  }
  const compact = chipType.toUpperCase().replace(/[\s_-]/g, "");
  if (compact.includes("ESP32S3")) {
    return "512 KB";
  }
  if (compact.includes("ESP32S2")) {
    return "320 KB";
  }
  return undefined;
}

function normalizeCapacityToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const mbMatch = trimmed.match(/(\d+)\s*MB/i);
  if (mbMatch) {
    return `${mbMatch[1]} MB`;
  }
  const kbMatch = trimmed.match(/(\d+)\s*KB/i);
  if (kbMatch) {
    return `${kbMatch[1]} KB`;
  }
  return trimmed;
}

function extractFeatureCapacity(
  features: string[],
  label: "flash" | "psram",
): string | undefined {
  const pattern =
    label === "flash"
      ? /embedded flash\s+(\d+\s*MB)/i
      : /embedded psram\s+(\d+\s*MB)/i;
  for (const feature of features) {
    const match = feature.match(pattern);
    if (match) {
      return normalizeCapacityToken(match[1]);
    }
  }
  return undefined;
}

function normalizeChipDescription(
  description: string,
): Pick<HardwareBoardInfo, "chipType" | "mcuModel" | "chipRevision"> {
  const [chipTypePart, revisionPart] = description
    .split(/\s+\(revision\s+/i)
    .map((part) => part.trim());
  const chipType = chipTypePart || description.trim();
  const compact = chipType.toUpperCase().replace(/[\s_-]/g, "");
  const canonicalModel = compact.startsWith("ESP32S3")
    ? "ESP32-S3"
    : compact.startsWith("ESP32S2")
      ? "ESP32-S2"
      : compact.startsWith("ESP32C3")
        ? "ESP32-C3"
        : compact.startsWith("ESP32C6")
          ? "ESP32-C6"
          : compact.startsWith("ESP32H2")
            ? "ESP32-H2"
            : compact.startsWith("ESP32P4")
              ? "ESP32-P4"
              : undefined;
  const modelMatch = chipType.match(/ESP32-[A-Z0-9]+/i);
  const revision = revisionPart?.replace(/\)$/g, "").trim();
  return {
    chipType: canonicalModel ?? chipType,
    mcuModel: canonicalModel ?? modelMatch?.[0]?.toUpperCase() ?? chipType,
    chipRevision: revision,
  };
}

export function nextJsonlRequestId(): number {
  const id = jsonlRequestSeq;
  jsonlRequestSeq = jsonlRequestSeq >= 999_999 ? 1 : jsonlRequestSeq + 1;
  return id;
}

export async function listLocalUsbSerialPorts(
  agent: DesktopAgent,
): Promise<SerialPortInfo[]> {
  const res = await agentFetch(agent, "/api/v1/serial/ports");
  if (!res.ok) {
    throw new Error(`Local USB port list failed (${res.status})`);
  }
  const json = (await res.json()) as {
    ports?: Array<
      SerialPortInfo & {
        portPath?: string | null;
      }
    >;
  };
  if (!Array.isArray(json.ports)) {
    return [];
  }
  return json.ports
    .map((port) => {
      const path = port.path || port.portPath || "";
      if (!path) {
        return null;
      }
      return {
        ...port,
        path,
      };
    })
    .filter((port): port is SerialPortInfo => port !== null);
}

export async function readLocalUsbBoardInfo(
  agent: DesktopAgent,
  portPath: string,
): Promise<HardwareBoardInfo> {
  const res = await agentFetch(agent, "/api/v1/serial/board-info", {
    method: "POST",
    body: JSON.stringify({ portPath }),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: HardwareBoardInfo;
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.ok || !json.result) {
    throw new Error(
      json?.error?.message ??
        `Local USB hardware probe failed (${res.status}).`,
    );
  }
  return json.result;
}

export function filterEsp32SerialPorts(
  ports: SerialPortInfo[],
): SerialPortInfo[] {
  const esp32Ports = ports
    .filter(isEsp32SerialPort)
    .sort(compareSerialPortsForConnect);
  return dedupeSerialDevicePairs(esp32Ports);
}

export function isEsp32SerialPort(port: SerialPortInfo): boolean {
  const path = port.path.toLowerCase();
  if (path.includes("bluetooth") || path.includes("debug-console")) {
    return false;
  }

  const manufacturer = (port.manufacturer ?? "").toLowerCase();
  const product = (port.product ?? port.label ?? "").toLowerCase();
  const vendorMatches = port.vendorId === ESPRESSIF_USB_VENDOR_ID;
  const serialJtagMatches =
    vendorMatches && port.productId === ESP32_USB_SERIAL_JTAG_PRODUCT_ID;
  if (serialJtagMatches) {
    return true;
  }

  const pathLooksLikeUsbSerial =
    path.includes("usbmodem") ||
    path.includes("usbserial") ||
    path.includes("ttyacm") ||
    /^com\d+$/i.test(port.path);
  const espressifTextMatches =
    manufacturer.includes("espressif") ||
    product.includes("esp32") ||
    product.includes("jtag/serial") ||
    product.includes("usb jtag");

  return pathLooksLikeUsbSerial && espressifTextMatches;
}

function compareSerialPortsForConnect(
  a: SerialPortInfo,
  b: SerialPortInfo,
): number {
  const aCu = isCuPort(a) ? 0 : 1;
  const bCu = isCuPort(b) ? 0 : 1;
  if (aCu !== bCu) {
    return aCu - bCu;
  }
  return a.path.localeCompare(b.path);
}

function dedupeSerialDevicePairs(ports: SerialPortInfo[]): SerialPortInfo[] {
  const seen = new Set<string>();
  const filtered: SerialPortInfo[] = [];
  for (const port of ports) {
    const key = port.serialNumber ?? pairedDeviceKey(port.path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    filtered.push(port);
  }
  return filtered;
}

function isCuPort(port: SerialPortInfo): boolean {
  return port.path.startsWith("/dev/cu.");
}

function pairedDeviceKey(path: string): string {
  return path.replace("/dev/tty.", "/dev/cu.");
}

export async function sendLocalUsbJsonlRequest(
  agent: DesktopAgent,
  portPath: string,
  request: JsonlRequest,
): Promise<unknown> {
  const previous = localUsbRequestQueues[portPath] ?? Promise.resolve();
  let releaseQueue: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  localUsbRequestQueues[portPath] = queued;
  await previous.catch(() => undefined);
  try {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= LOCAL_USB_BUSY_RETRIES; attempt += 1) {
      try {
        return await sendLocalUsbJsonlRequestNow(agent, portPath, request);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Local USB request failed");
        lastError = error;
        if (!error.message.includes("serial port is busy")) {
          throw error;
        }
        if (attempt >= LOCAL_USB_BUSY_RETRIES) {
          throw error;
        }
        await delay(200 + attempt * 250);
      }
    }
    throw lastError ?? new Error("Local USB request failed");
  } finally {
    releaseQueue();
    if (localUsbRequestQueues[portPath] === queued) {
      delete localUsbRequestQueues[portPath];
    }
  }
}

export async function sendDevdLocalUsbJsonlRequest(
  agent: DesktopAgent,
  deviceId: string,
  request: JsonlRequest,
): Promise<unknown> {
  await ensureDevdLocalUsbDeviceRegistered(agent, deviceId);
  const endpoint = localUsbMethodEndpoint(deviceId, request);
  let lease: { lease_id: string } | null = null;
  try {
    if (request.method === "reboot") {
      lease = await createLocalUsbLease(agent, deviceId);
      endpoint.body = {
        ...(endpoint.body as object),
        lease_id: lease.lease_id,
      };
    }
    const res = await agentFetch(agent, endpoint.path, {
      method: endpoint.method,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as {
      response?: unknown;
      error?: { code?: string; message?: string; retryable?: boolean };
    } | null;
    if (!res.ok) {
      throw new LocalUsbAgentHttpError(
        json?.error?.message ?? `Local USB request failed (${res.status})`,
        res.status,
        json?.error?.code,
        json?.error?.retryable,
      );
    }
    return json?.response ?? json;
  } finally {
    if (lease) {
      await releaseLocalUsbLease(agent, lease.lease_id);
    }
  }
}

async function ensureDevdLocalUsbDeviceRegistered(
  agent: DesktopAgent,
  deviceId: string,
): Promise<void> {
  const res = await agentFetch(agent, "/api/v1/devices/scan", {
    method: "POST",
  });
  const json = (await res.json().catch(() => null)) as {
    devices?: Array<{ id?: string }>;
    error?: { code?: string; message?: string; retryable?: boolean };
  } | null;
  if (!res.ok) {
    throw new LocalUsbAgentHttpError(
      json?.error?.message ?? "Local USB scan failed",
      res.status,
      json?.error?.code,
      json?.error?.retryable,
    );
  }
  if (!json?.devices?.some((device) => device.id === deviceId)) {
    throw new Error(`Local USB device is not available: ${deviceId}`);
  }
}

async function sendLocalUsbJsonlRequestNow(
  agent: DesktopAgent,
  portPath: string,
  request: JsonlRequest,
): Promise<unknown> {
  const deviceId = stableLocalUsbDeviceId(portPath);
  await ensureLocalUsbDeviceRegistered(agent, deviceId, portPath);
  const endpoint = localUsbMethodEndpoint(deviceId, request);
  let lease: { lease_id: string } | null = null;
  try {
    if (request.method === "reboot") {
      lease = await createLocalUsbLease(agent, deviceId);
      endpoint.body = {
        ...(endpoint.body as object),
        lease_id: lease.lease_id,
      };
    }
    const res = await agentFetch(agent, endpoint.path, {
      method: endpoint.method,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as {
      response?: unknown;
      error?: { code?: string; message?: string; retryable?: boolean };
    } | null;
    if (!res.ok) {
      if (shouldFallbackToLegacySerialApi(res.status)) {
        return legacyLocalUsbJsonlRequest(agent, portPath, request);
      }
      throw new LocalUsbAgentHttpError(
        json?.error?.message ?? `Local USB request failed (${res.status})`,
        res.status,
        json?.error?.code,
        json?.error?.retryable,
      );
    }
    if (!isUsableLocalUsbJson(json)) {
      return legacyLocalUsbJsonlRequest(agent, portPath, request);
    }
    return json?.response ?? json;
  } catch (err) {
    if (
      err instanceof LocalUsbAgentHttpError &&
      shouldFallbackToLegacySerialApi(err.status)
    ) {
      return legacyLocalUsbJsonlRequest(agent, portPath, request);
    }
    throw err;
  } finally {
    if (lease) {
      await releaseLocalUsbLease(agent, lease.lease_id);
    }
  }
}

async function legacyLocalUsbJsonlRequest(
  agent: DesktopAgent,
  portPath: string,
  request: JsonlRequest,
): Promise<unknown> {
  const res = await agentFetch(agent, "/api/v1/serial/request", {
    method: "POST",
    body: JSON.stringify({
      portPath,
      request,
      timeoutMs: request.timeoutMs,
    }),
  });
  const json = (await res.json().catch(() => null)) as {
    response?: unknown;
    error?: { code?: string; message?: string; retryable?: boolean };
  } | null;
  if (!res.ok) {
    throw new LocalUsbAgentHttpError(
      json?.error?.message ?? `Local USB request failed (${res.status})`,
      res.status,
      json?.error?.code,
      json?.error?.retryable,
    );
  }
  return json?.response ?? json;
}

export function stableLocalUsbDeviceId(portPath: string): string {
  const sanitized = Array.from(portPath)
    .map((ch) => (/[a-zA-Z0-9]/.test(ch) ? ch : "-"))
    .join("");
  return `usb-${sanitized}`;
}

export function devdLocalUsbDeviceIdFromBaseUrl(
  baseUrl: string,
): string | null {
  const prefix = "isolapurr-devd://";
  if (!baseUrl.startsWith(prefix)) {
    return null;
  }
  const deviceId = baseUrl.slice(prefix.length).trim();
  return deviceId.length > 0 ? deviceId : null;
}

async function ensureLocalUsbDeviceRegistered(
  agent: DesktopAgent,
  deviceId: string,
  portPath: string,
): Promise<void> {
  const res = await agentFetch(agent, "/api/v1/serial/register", {
    method: "POST",
    body: JSON.stringify({ portPath }),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    device?: { id?: string; usb?: { portPath?: string } };
    error?: { code?: string; message?: string; retryable?: boolean };
  } | null;
  if (!res.ok) {
    throw new LocalUsbAgentHttpError(
      json?.error?.message ?? "Local USB register failed",
      res.status,
      json?.error?.code,
      json?.error?.retryable,
    );
  }
  const registered =
    json?.ok === true &&
    (json.device?.id === deviceId || json.device?.usb?.portPath === portPath);
  if (!registered) {
    throw new Error(`Local USB device is not available: ${portPath}`);
  }
}

function localUsbMethodEndpoint(
  deviceId: string,
  request: JsonlRequest,
): { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown } {
  const params = request.params ?? {};
  switch (request.method) {
    case "info":
      return { method: "GET", path: `/api/v1/devices/${deviceId}/status` };
    case "ports.get":
      return { method: "GET", path: `/api/v1/devices/${deviceId}/ports` };
    case "wifi.get":
      return { method: "GET", path: `/api/v1/devices/${deviceId}/wifi` };
    case "wifi.set":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/wifi`,
        body: params,
      };
    case "wifi.clear":
      return { method: "DELETE", path: `/api/v1/devices/${deviceId}/wifi` };
    case "settings.reset":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/settings/reset`,
        body: params,
      };
    case "reboot":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/reset`,
        body: {},
      };
    case "port.power_set": {
      const port = String(params.port ?? "");
      const enabled = params.enabled ? "1" : "0";
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/ports/${port}/power?enabled=${enabled}`,
      };
    }
    case "port.replug": {
      const port = String(params.port ?? "");
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/ports/${port}/replug`,
      };
    }
    case "hub.route_set":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/hub/route`,
        body: params,
      };
    case "pd.diagnostics_get":
      return {
        method: "GET",
        path: `/api/v1/devices/${deviceId}/pd-diagnostics`,
      };
    case "power.config_get":
      return {
        method: "GET",
        path: `/api/v1/devices/${deviceId}/power/config`,
      };
    case "power.config_set":
      return {
        method: "PUT",
        path: `/api/v1/devices/${deviceId}/power/config?owner=${Number(params.owner ?? 0)}`,
        body: params.config,
      };
    case "power.config_defaults":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/power/config/defaults?owner=${Number(params.owner ?? 0)}`,
      };
    case "power.runtime_set":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/power/runtime?owner=${Number(params.owner ?? 0)}`,
        body: params,
      };
    case "power.lock":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/power/config/${params.acquire === false ? "release" : "lock"}?owner=${Number(params.owner ?? 0)}`,
      };
    case "power.idle_bias_get":
      return {
        method: "GET",
        path: `/api/v1/devices/${deviceId}/power/idle-bias`,
      };
    case "power.idle_bias_set":
      return {
        method: "PUT",
        path: `/api/v1/devices/${deviceId}/power/idle-bias?owner=${Number(params.owner ?? 0)}`,
        body: { correction_enabled: Boolean(params.correction_enabled) },
      };
    case "power.idle_bias_run":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/power/idle-bias/run?owner=${Number(params.owner ?? 0)}`,
      };
    case "power.idle_bias_clear":
      return {
        method: "POST",
        path: `/api/v1/devices/${deviceId}/power/idle-bias/clear?owner=${Number(params.owner ?? 0)}`,
      };
    default:
      throw new Error(`Unsupported Local USB method: ${request.method}`);
  }
}

async function createLocalUsbLease(
  agent: DesktopAgent,
  deviceId: string,
): Promise<{ lease_id: string }> {
  const res = await agentFetch(agent, "/api/v1/serial/lease", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId }),
  });
  const json = (await res.json().catch(() => null)) as {
    lease_id?: string;
    error?: { code?: string; message?: string; retryable?: boolean };
  } | null;
  if (!res.ok || typeof json?.lease_id !== "string") {
    throw new LocalUsbAgentHttpError(
      json?.error?.message ?? "Local USB lease failed",
      res.status,
      json?.error?.code,
      json?.error?.retryable,
    );
  }
  return { lease_id: json.lease_id };
}

async function releaseLocalUsbLease(
  agent: DesktopAgent,
  leaseId: string,
): Promise<void> {
  await agentFetch(agent, `/api/v1/serial/lease/${leaseId}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

export async function flashWithLocalUsb(
  agent: DesktopAgent,
  portPath: string,
  file: File,
  address: number,
  expectedIdentity: DeviceIdentityExpectation,
): Promise<string> {
  if (address !== DEFAULT_LOCAL_USB_FLASH_ADDRESS) {
    throw new Error(
      "Local USB firmware flashing writes the app image at 0x10000.",
    );
  }
  const deviceId = stableLocalUsbDeviceId(portPath);
  const firmware = await fileToBase64(file);
  let lease: { lease_id: string } | null = null;
  try {
    await ensureLocalUsbDeviceRegistered(agent, deviceId, portPath);
    lease = await createLocalUsbLease(agent, deviceId);
    const res = await agentFetch(
      agent,
      `/api/v1/devices/${deviceId}/flash-upload`,
      {
        method: "POST",
        body: JSON.stringify({
          address,
          fileName: file.name,
          fileBase64: firmware,
          expectedIdentity: {
            deviceId: expectedIdentity.deviceId ?? undefined,
            mac: expectedIdentity.mac ?? undefined,
          },
          leaseId: lease.lease_id,
        }),
      },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      log?: string;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    if (!res.ok || !json.ok) {
      if (res.status === 404) {
        return legacyFlashWithLocalUsb(
          agent,
          portPath,
          file.name,
          address,
          firmware,
          expectedIdentity,
        );
      }
      throw new LocalUsbAgentHttpError(
        json.error?.message ||
          json.log ||
          `Local USB flash failed (${res.status})`,
        res.status,
        json.error?.code,
        json.error?.retryable,
      );
    }
    return json.log ?? "";
  } catch (err) {
    if (err instanceof LocalUsbAgentHttpError && err.status === 404) {
      return legacyFlashWithLocalUsb(
        agent,
        portPath,
        file.name,
        address,
        firmware,
        expectedIdentity,
      );
    }
    throw err;
  } finally {
    if (lease) {
      await releaseLocalUsbLease(agent, lease.lease_id);
    }
  }
}

export async function flashBundledWithLocalUsb(
  agent: DesktopAgent,
  portPath: string,
  release: BundledFirmwareRelease,
  asset: BundledFirmwareAsset,
  firstTime: boolean,
  expectedIdentity?: DeviceIdentityExpectation,
  confirmNonProjectFirmware = false,
): Promise<string> {
  const deviceId = stableLocalUsbDeviceId(portPath);
  const assetResponse = await fetch(asset.assetPath, { cache: "no-store" });
  if (!assetResponse.ok) {
    throw new Error(`Firmware asset request failed (${assetResponse.status}).`);
  }
  const firmware = await fileToBase64(
    new File([await assetResponse.arrayBuffer()], asset.fileName, {
      type: "application/octet-stream",
    }),
  );
  const catalogResponse = await fetch(release.catalogPath, {
    cache: "no-store",
  });
  if (!catalogResponse.ok) {
    throw new Error(
      `Firmware catalog request failed (${catalogResponse.status}).`,
    );
  }
  const catalog = (await catalogResponse.json()) as Record<string, unknown>;
  let lease: { lease_id: string } | null = null;
  try {
    await ensureLocalUsbDeviceRegistered(agent, deviceId, portPath);
    lease = await createLocalUsbLease(agent, deviceId);
    const res = await agentFetch(
      agent,
      `/api/v1/devices/${deviceId}/flash-bundled`,
      {
        method: "POST",
        body: JSON.stringify({
          catalog,
          artifactId: asset.artifactId,
          fileKind: asset.fileKind,
          fileName: asset.fileName,
          fileBase64: firmware,
          firstTime,
          confirmNonProjectFirmware,
          expectedIdentity: expectedIdentity
            ? {
                deviceId: expectedIdentity.deviceId ?? undefined,
                mac: expectedIdentity.mac ?? undefined,
              }
            : undefined,
          leaseId: lease.lease_id,
        }),
      },
    );
    const json = (await res.json()) as {
      ok?: boolean;
      log?: string;
      error?: { code?: string; message?: string; retryable?: boolean };
    };
    if (!res.ok || !json.ok) {
      throw new LocalUsbAgentHttpError(
        json.error?.message ||
          json.log ||
          `Local USB flash failed (${res.status})`,
        res.status,
        json.error?.code,
        json.error?.retryable,
      );
    }
    return json.log ?? "";
  } finally {
    if (lease) {
      await releaseLocalUsbLease(agent, lease.lease_id);
    }
  }
}

async function legacyFlashWithLocalUsb(
  agent: DesktopAgent,
  portPath: string,
  fileName: string,
  address: number,
  fileBase64: string,
  expectedIdentity: DeviceIdentityExpectation,
): Promise<string> {
  const res = await agentFetch(agent, "/api/v1/firmware/flash", {
    method: "POST",
    body: JSON.stringify({
      portPath,
      address,
      fileName,
      fileBase64,
      expectedIdentity: {
        deviceId: expectedIdentity.deviceId ?? undefined,
        mac: expectedIdentity.mac ?? undefined,
      },
    }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    log?: string;
    error?: { code?: string; message?: string; retryable?: boolean };
  };
  if (!res.ok || !json.ok) {
    throw new LocalUsbAgentHttpError(
      json.error?.message ||
        json.log ||
        `Local USB flash failed (${res.status})`,
      res.status,
      json.error?.code,
      json.error?.retryable,
    );
  }
  return json.log ?? "";
}

export class WebSerialJsonlTransport {
  private port: SerialLikePort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private requestQueue: Promise<void> = Promise.resolve();
  private buffered = "";
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timeoutId: number;
    }
  >();

  async connect(): Promise<void> {
    await this.connectWithPicker();
  }

  async connectWithPicker(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new Error("Web Serial is not supported by this browser");
    }
    await this.connectToPort(await requestWebSerialPort());
  }

  async connectToPort(port: SerialLikePort): Promise<void> {
    await port.open({ baudRate: 115200 });
    this.reader = port.readable?.getReader() ?? null;
    this.writer = port.writable?.getWriter() ?? null;
    this.decoder = new TextDecoder();
    this.buffered = "";
    this.port = port;
    void this.readSerialLoop();
  }

  async takePortForExclusiveUse(): Promise<SerialLikePort> {
    const port = this.port;
    if (!port) {
      throw new Error("Web Serial transport is not connected");
    }
    await this.disconnect();
    return port;
  }

  async request(request: JsonlRequest): Promise<unknown> {
    const run = this.requestQueue.then(() => this.performRequest(request));
    this.requestQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async performRequest(request: JsonlRequest): Promise<unknown> {
    if (!this.reader || !this.writer) {
      throw new Error("Web Serial transport is not connected");
    }
    const payload = `${JSON.stringify(request)}\n`;
    const response = this.waitForResponse(request);
    try {
      await this.writer.write(new TextEncoder().encode(payload));
      return await response;
    } catch (err) {
      this.clearPendingRequest(request.id);
      throw err;
    }
  }

  private waitForResponse(request: JsonlRequest): Promise<unknown> {
    const key = String(request.id);
    this.clearPendingRequest(request.id);
    return new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.pending.delete(key);
        reject(
          new Error(
            "No IsolaPurr JSONL response received from this serial device.",
          ),
        );
      }, request.timeoutMs ?? DEFAULT_JSONL_TIMEOUT_MS);
      this.pending.set(key, { resolve, reject, timeoutId });
    });
  }

  private clearPendingRequest(requestId: number): void {
    const key = String(requestId);
    const pending = this.pending.get(key);
    if (!pending) {
      return;
    }
    globalThis.clearTimeout(pending.timeoutId);
    this.pending.delete(key);
  }

  private async readSerialLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) {
      return;
    }
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error("Serial stream closed before a JSONL response");
        }
        this.buffered += this.decoder.decode(chunk.value, { stream: true });
        this.drainBufferedLines();
      }
    } catch (err) {
      if (this.reader === reader) {
        this.rejectPending(
          err instanceof Error ? err : new Error("Web Serial read failed"),
        );
      }
    }
  }

  private drainBufferedLines(): void {
    for (;;) {
      const newline = this.buffered.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = this.buffered.slice(0, newline).trim();
      this.buffered = this.buffered.slice(newline + 1);
      if (!line) {
        continue;
      }
      const parsed = parseWebSerialJsonLine(line);
      if (parsed === null) {
        // Ignore boot logs or non-IsolaPurr serial output until a JSONL frame appears.
        continue;
      }
      const id = jsonlResponseId(parsed);
      if (id === null) {
        continue;
      }
      const pending = this.pending.get(id);
      if (!pending) {
        continue;
      }
      globalThis.clearTimeout(pending.timeoutId);
      this.pending.delete(id);
      pending.resolve(parsed);
    }
  }

  private rejectPending(err: Error): void {
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timeoutId);
      pending.reject(err);
    }
    this.pending.clear();
  }

  async disconnect(): Promise<void> {
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;

    this.reader = null;
    this.writer = null;
    this.port = null;
    this.decoder = new TextDecoder();
    this.buffered = "";
    this.requestQueue = Promise.resolve();
    this.rejectPending(new Error("Web Serial transport disconnected"));

    try {
      await reader?.cancel();
    } catch {
      // Ignore cancellation errors while tearing down the serial stream.
    }

    try {
      reader?.releaseLock();
    } catch {
      // The reader may already be released after cancellation.
    }

    try {
      writer?.releaseLock();
    } catch {
      // The writer may already be released if the port was closed externally.
    }

    try {
      await port?.close();
    } catch (err) {
      if (
        !(err instanceof DOMException) ||
        !err.message.includes("already closed")
      ) {
        throw err;
      }
    }
  }
}

export async function probeWebSerialBoard(
  port: SerialLikePort,
): Promise<HardwareBoardInfo> {
  const { ESPLoader, Transport } = await import("esptool-js");
  const transport = new Transport(port, true);
  const terminal = {
    clean() {},
    writeLine() {},
    write() {},
  };
  const loader = new ESPLoader({
    transport,
    baudrate: 115200,
    terminal,
    debugLogging: false,
  });
  patchEsp32S3UsbJtagStubStart(loader as EsptoolLoaderWithInternals);

  try {
    await loader.main("usb_reset");
    const chipDescription = await loader.chip.getChipDescription(loader);
    const features = await loader.chip.getChipFeatures(loader);
    const macAddress = await loader.chip.readMac(loader);
    const crystalFrequency = await loader.chip.getCrystalFreq(loader);
    const flashSize = normalizeCapacityToken(
      await loader.detectFlashSize().catch(() => undefined),
    );
    const normalized = normalizeChipDescription(chipDescription);
    return {
      source: "esptool-js",
      ...normalized,
      flashSize: flashSize ?? extractFeatureCapacity(features, "flash"),
      ramSize: inferRamSize(normalized.chipType),
      // `getChipFeatures()` reports chip/package capabilities rather than
      // always reflecting soldered PSRAM on the attached board. Keep Web
      // Serial conservative here so the UI does not invent PSRAM that the
      // Local USB hardware probe cannot confirm.
      psramSize: undefined,
      macAddress,
      crystalFrequency:
        typeof crystalFrequency === "number"
          ? `${crystalFrequency} MHz`
          : undefined,
      features,
    };
  } finally {
    try {
      await loader.after("hard_reset");
    } catch {
      // Ignore reset failures while returning to runtime mode.
    }
    try {
      await transport.disconnect();
    } catch {
      try {
        await port.close();
      } catch {
        // Browser-owned serial ports may already be closed after reset.
      }
    }
  }
}

async function requestWebSerialPort(): Promise<SerialLikePort> {
  return (await navigator.serial.requestPort({
    filters: [
      {
        usbVendorId: ESPRESSIF_USB_VENDOR_ID,
        usbProductId: ESP32_USB_SERIAL_JTAG_PRODUCT_ID,
      },
      { usbVendorId: ESPRESSIF_USB_VENDOR_ID },
    ],
  })) as SerialLikePort;
}

function jsonlResponseId(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

export function parseWebSerialJsonLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

export async function flashWithWebSerial(
  port: SerialLikePort,
  file: File,
  address: number,
  onProgress: (progress: FirmwareFlashProgress) => void,
): Promise<void> {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial is not supported by this browser");
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const { ESPLoader, Transport } = await import("esptool-js");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const transport = new Transport(port, true);
    const terminal = {
      clean() {},
      writeLine(message: string) {
        onProgress({ stage: "connecting", message });
      },
      write(message: string) {
        onProgress({ stage: "connecting", message });
      },
    };
    const loader = new ESPLoader({
      transport,
      baudrate: 115200,
      terminal,
      debugLogging: false,
    });
    patchEsp32S3UsbJtagStubStart(loader as EsptoolLoaderWithInternals);

    onProgress({ stage: "connecting", message: "Connecting to bootloader" });
    try {
      await loader.main("usb_reset");
      await loader.writeFlash({
        fileArray: [{ data, address }],
        flashMode: "dio",
        flashFreq: "40m",
        flashSize: "4MB",
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex, written, total) => {
          onProgress({
            stage: "writing",
            message: "Writing firmware",
            written,
            total,
          });
        },
      });
      await loader.after("hard_reset");
      await resetEsp32S3UsbJtagToApp(transport as EsptoolTransportWithSignals);
      onProgress({ stage: "done", message: "Firmware written" });
      return;
    } catch (err) {
      if (attempt < 2 && isRetryableWebSerialOpenError(err)) {
        onProgress({
          stage: "connecting",
          message: "Web Serial port is reopening after reset, retrying…",
        });
        await delay(250 * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      await transport.disconnect().catch(() => undefined);
    }
  }
}

function isRetryableWebSerialOpenError(err: unknown): boolean {
  if (!(err instanceof Error) && !(err instanceof DOMException)) {
    return false;
  }
  const message = err.message.toLowerCase();
  return (
    message.includes("failed to open serial port") ||
    message.includes("failed to execute 'open' on 'serialport'")
  );
}

function patchEsp32S3UsbJtagStubStart(loader: EsptoolLoaderWithInternals) {
  loader.memFinish = async (entrypoint: number) => {
    const isEntry = entrypoint === 0 ? 1 : 0;
    const packet = loader._appendArray(
      loader._intToByteArray(isEntry),
      loader._intToByteArray(entrypoint),
    );
    await loader.checkCommand(
      "leave RAM download mode",
      loader.ESP_MEM_END,
      packet,
      undefined,
      undefined,
      2_000,
    );
  };
}

async function resetEsp32S3UsbJtagToApp(
  transport: EsptoolTransportWithSignals,
): Promise<void> {
  await transport.setDTR(false);
  await transport.setRTS(false);
  await delay(100);
  await transport.setDTR(true);
  await transport.setRTS(false);
  await delay(100);
  await transport.setDTR(false);
  await transport.setRTS(true);
  await delay(100);
  await transport.setDTR(false);
  await transport.setRTS(false);
  await delay(500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x2000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
