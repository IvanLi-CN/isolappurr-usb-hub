import {
  type FirmwareFlashProgress,
  type HardwareBoardInfo,
  isWebSerialSupported,
  type JsonlRequest,
  requestWebSerialPort,
  type SerialLikePort,
} from "./hardwareConsole";

const DEFAULT_JSONL_TIMEOUT_MS = 5_000;

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
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await port.open({ baudRate: 115200 });
        this.reader = port.readable?.getReader() ?? null;
        this.writer = port.writable?.getWriter() ?? null;
        this.decoder = new TextDecoder();
        this.buffered = "";
        this.port = port;
        void this.readSerialLoop();
        return;
      } catch (err) {
        if (attempt < 5 && isRetryableWebSerialOpenError(err)) {
          await delay(250 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
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
      await resetEsp32S3UsbJtagToApp(transport as EsptoolTransportWithSignals);
    } catch {
      // Ignore control-line recovery failures; callers will re-check whether
      // the firmware runtime actually resumed after the low-level probe.
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
