import { agentFetch, type DesktopAgent } from "./desktopAgent";

export type JsonlRequest = {
  id: number;
  method: string;
  params?: Record<string, unknown>;
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

export type HardwareTransportKind = "web_serial" | "native_proxy";

export type FirmwareFlashProgress = {
  stage: "connecting" | "writing" | "done";
  message: string;
  written?: number;
  total?: number;
};

type SerialLikePort = SerialPort & {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
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
      requestPort(options?: unknown): Promise<SerialPort>;
    };
  }
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function listNativeSerialPorts(
  agent: DesktopAgent,
): Promise<SerialPortInfo[]> {
  const res = await agentFetch(agent, "/api/v1/serial/ports");
  if (!res.ok) {
    throw new Error(`Native serial port list failed (${res.status})`);
  }
  const json = (await res.json()) as { ports?: SerialPortInfo[] };
  return Array.isArray(json.ports) ? json.ports : [];
}

export async function sendNativeJsonlRequest(
  agent: DesktopAgent,
  portPath: string,
  request: JsonlRequest,
): Promise<unknown> {
  const res = await agentFetch(agent, "/api/v1/serial/request", {
    method: "POST",
    body: JSON.stringify({ portPath, request }),
  });
  if (!res.ok) {
    throw new Error(`Native serial request failed (${res.status})`);
  }
  const json = (await res.json()) as { response?: unknown };
  return json.response ?? json;
}

export async function flashWithNativeProxy(
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
    throw new Error(json.log || `Native flash failed (${res.status})`);
  }
  return json.log ?? "";
}

export class WebSerialJsonlTransport {
  private port: SerialLikePort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new Error("Web Serial is not supported by this browser");
    }
    const port = (await navigator.serial.requestPort()) as SerialLikePort;
    await port.open({ baudRate: 115200 });
    const decoder = new TextDecoderStream();
    port.readable
      ?.pipeTo(decoder.writable as WritableStream<Uint8Array>)
      .catch(() => undefined);
    this.reader = decoder.readable.getReader();
    this.writer = port.writable?.getWriter() ?? null;
    this.port = port;
  }

  async request(request: JsonlRequest): Promise<unknown> {
    if (!this.reader || !this.writer) {
      throw new Error("Web Serial transport is not connected");
    }
    const payload = `${JSON.stringify(request)}\n`;
    await this.writer.write(new TextEncoder().encode(payload));

    let buffered = "";
    while (true) {
      const chunk = await this.reader.read();
      if (chunk.done) {
        throw new Error("Serial stream closed before a JSONL response");
      }
      buffered += chunk.value;
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        if (line) {
          return JSON.parse(line) as unknown;
        }
      }
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel();
    } finally {
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
      this.reader = null;
      this.writer = null;
      this.port = null;
    }
  }
}

export async function flashWithWebSerial(
  file: File,
  address: number,
  onProgress: (progress: FirmwareFlashProgress) => void,
): Promise<void> {
  if (!isWebSerialSupported()) {
    throw new Error("Web Serial is not supported by this browser");
  }

  const { ESPLoader, Transport } = await import("esptool-js");
  const port = await navigator.serial.requestPort();
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

  onProgress({ stage: "connecting", message: "Connecting to bootloader" });
  await loader.main();
  const data = new Uint8Array(await file.arrayBuffer());
  await loader.writeFlash({
    fileArray: [{ data, address }],
    flashMode: "dio",
    flashFreq: "40m",
    flashSize: "16MB",
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
  onProgress({ stage: "done", message: "Firmware written" });
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
