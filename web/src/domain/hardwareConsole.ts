import { agentFetch, type DesktopAgent } from "./desktopAgent";
import type {
  BundledFirmwareAsset,
  BundledFirmwareRelease,
} from "./firmwareBundle";

export {
  flashWithWebSerial,
  parseWebSerialJsonLine,
  probeWebSerialBoard,
  WebSerialJsonlTransport,
} from "./webSerialFirmware";

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
  source: "firmware" | "firmware-profile" | "esptool-js" | "espflash";
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

declare global {
  type SerialPort = {
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    forget?: () => Promise<void>;
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
  options: { signal?: AbortSignal; deadlineAt?: number } = {},
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
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error("Web Serial probe timed out.");
    }
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      throw new Error("Web Serial probe timed out.");
    }
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
    const retryDelay = 120 * (attempt + 1);
    const remaining =
      options.deadlineAt === undefined
        ? retryDelay
        : Math.max(0, options.deadlineAt - Date.now());
    if (remaining === 0) {
      throw new Error("Web Serial probe timed out.");
    }
    await delay(Math.min(retryDelay, remaining));
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

export async function getReusableGrantedWebSerialPort(
  preferred?: SerialLikePort | null,
): Promise<SerialLikePort | null> {
  if (!isWebSerialSupported() || !navigator.serial.getPorts) {
    return null;
  }
  const granted = (await navigator.serial.getPorts()) as SerialLikePort[];
  return resolveGrantedWebSerialPort(granted, preferred);
}

export async function forgetGrantedWebSerialPort(
  preferred?: SerialLikePort | null,
): Promise<boolean> {
  if (!isWebSerialSupported()) {
    return false;
  }

  let target = preferred ?? null;
  if (navigator.serial.getPorts) {
    if (preferred) {
      target = await refreshGrantedWebSerialPort(preferred).catch(
        () => preferred,
      );
    } else {
      target = await getReusableGrantedWebSerialPort();
    }
  }
  if (!target) {
    return false;
  }

  try {
    await target.close();
  } catch (err) {
    if (
      !(err instanceof DOMException) ||
      !err.message.includes("already closed")
    ) {
      // Ignore close failures here and still attempt forget when supported.
    }
  }

  if (typeof target.forget !== "function") {
    return false;
  }
  await target.forget();
  return true;
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

export async function requestWebSerialPort(
  preferred?: SerialLikePort | null,
): Promise<SerialLikePort> {
  const reusable = await getReusableGrantedWebSerialPort(preferred);
  if (reusable) {
    return reusable;
  }
  return requestNewWebSerialPort();
}

export async function requestNewWebSerialPort(): Promise<SerialLikePort> {
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
