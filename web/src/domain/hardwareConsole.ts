import { agentFetch, type DesktopAgent } from "./desktopAgent";

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
};

const ESPRESSIF_USB_VENDOR_ID = 0x303a;
const ESP32_USB_SERIAL_JTAG_PRODUCT_ID = 0x1001;
const DEFAULT_JSONL_TIMEOUT_MS = 5_000;
let jsonlRequestSeq = 1;

export type HardwareTransportKind = "web_serial" | "local_usb";

export type FirmwareFlashProgress = {
  stage: "connecting" | "writing" | "done";
  message: string;
  written?: number;
  total?: number;
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
  const json = (await res.json()) as { ports?: SerialPortInfo[] };
  return Array.isArray(json.ports) ? json.ports : [];
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
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    throw new Error(
      json?.error?.message ?? `Local USB request failed (${res.status})`,
    );
  }
  return json?.response ?? json;
}

export async function flashWithLocalUsb(
  agent: DesktopAgent,
  portPath: string,
  file: File,
  address: number,
): Promise<string> {
  const firmware = await fileToBase64(file);
  const res = await agentFetch(agent, "/api/v1/firmware/flash", {
    method: "POST",
    body: JSON.stringify({
      portPath,
      address,
      fileName: file.name,
      fileBase64: firmware,
    }),
  });
  const json = (await res.json()) as { ok?: boolean; log?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.log || `Local USB flash failed (${res.status})`);
  }
  return json.log ?? "";
}

export class WebSerialJsonlTransport {
  private port: SerialLikePort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private decoder = new TextDecoder();
  private requestQueue: Promise<void> = Promise.resolve();

  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new Error("Web Serial is not supported by this browser");
    }
    const grantedPort = await findGrantedWebSerialPort();
    if (grantedPort) {
      try {
        await this.connectToPort(grantedPort);
        return;
      } catch {
        await this.disconnect().catch(() => undefined);
      }
    }
    await this.connectToPort(await requestWebSerialPort());
  }

  async connectGranted(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new Error("Web Serial is not supported by this browser");
    }
    const port = await findGrantedWebSerialPort();
    if (!port) {
      throw new Error("No authorized ESP32-S3 Web Serial port is available.");
    }
    await this.connectToPort(port);
  }

  async connectToPort(port: SerialLikePort): Promise<void> {
    await port.open({ baudRate: 115200 });
    this.reader = port.readable?.getReader() ?? null;
    this.writer = port.writable?.getWriter() ?? null;
    this.decoder = new TextDecoder();
    this.port = port;
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
    await this.writer.write(new TextEncoder().encode(payload));

    let buffered = "";
    const deadline =
      Date.now() + (request.timeoutMs ?? DEFAULT_JSONL_TIMEOUT_MS);
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await readWithTimeout(this.reader, remaining);
      if (!chunk) {
        break;
      }
      buffered += this.decoder.decode(chunk.value, { stream: true });
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (jsonlResponseMatchesRequest(parsed, request.id)) {
              return parsed;
            }
          } catch {
            // Ignore boot logs or non-IsolaPurr serial output until a JSONL frame appears.
          }
        }
      }
    }
    throw new Error(
      "No IsolaPurr JSONL response received from this serial device.",
    );
  }

  async disconnect(): Promise<void> {
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;

    this.reader = null;
    this.writer = null;
    this.port = null;
    this.decoder = new TextDecoder();
    this.requestQueue = Promise.resolve();

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

async function findGrantedWebSerialPort(): Promise<SerialLikePort | null> {
  const ports = ((await navigator.serial.getPorts?.()) ??
    []) as SerialLikePort[];
  return ports.find(isEspressifWebSerialPort) ?? null;
}

function isEspressifWebSerialPort(port: SerialLikePort): boolean {
  const info = port.getInfo?.();
  if (!info) {
    return false;
  }
  return (
    info.usbVendorId === ESPRESSIF_USB_VENDOR_ID &&
    (!info.usbProductId ||
      info.usbProductId === ESP32_USB_SERIAL_JTAG_PRODUCT_ID)
  );
}

function jsonlResponseMatchesRequest(
  value: unknown,
  requestId: number,
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const id = (value as { id?: unknown }).id;
  return id === requestId || String(id) === String(requestId);
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  let timeoutId = 0;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
  });
  const result = await Promise.race([reader.read(), timeout]);
  window.clearTimeout(timeoutId);
  if (!result) {
    return null;
  }
  if (result.done) {
    throw new Error("Serial stream closed before a JSONL response");
  }
  return result;
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

  const { ESPLoader, Transport } = await import("esptool-js");
  const transport = new Transport(port, true);
  const terminal = {
    clean() {},
    writeLine(data: string) {
      onProgress({ stage: "connecting", message: data });
    },
    write(data: string) {
      onProgress({ stage: "connecting", message: data });
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
    const data = new Uint8Array(await file.arrayBuffer());
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
  } finally {
    await transport.disconnect().catch(() => undefined);
  }
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
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
