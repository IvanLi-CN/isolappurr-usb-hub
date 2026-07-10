import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const serialPath = process.env.ISOLAPURR_WEB_SERIAL_HIL_PORT;
const expectedDeviceId = process.env.ISOLAPURR_WEB_SERIAL_HIL_DEVICE_ID;
const expectedMac = process.env.ISOLAPURR_WEB_SERIAL_HIL_MAC?.toLowerCase();

type BridgeResponse = {
  id: number;
  result?: unknown;
  error?: string;
};

class SerialBridge {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly startedAt = performance.now();
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly stderr: string[] = [];
  private readonly trace: string[] = [];
  private readonly methodCounts = new Map<string, number>();

  constructor(path: string) {
    const bridgePath = fileURLToPath(
      new URL("./support/serial_bridge.py", import.meta.url),
    );
    this.child = spawn("python3", [bridgePath, "--port", path], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const response = JSON.parse(line) as BridgeResponse;
      const request = this.pending.get(response.id);
      if (!request) {
        return;
      }
      this.pending.delete(response.id);
      if (response.error) {
        this.trace.push(
          `${this.elapsed()} response ${response.id} error=${response.error}`,
        );
        request.reject(new Error(response.error));
      } else {
        if (typeof response.result === "string" && response.result.length > 0) {
          this.trace.push(
            `${this.elapsed()} response ${response.id} bytes=${Math.floor((response.result.length * 3) / 4)}`,
          );
        }
        request.resolve(response.result);
      }
    });
    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.stderr.push(line);
    });
    this.child.once("exit", (code) => {
      const detail = this.stderr.join("\n");
      const error = new Error(
        `serial bridge exited with code ${String(code)}${detail ? `: ${detail}` : ""}`,
      );
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  request(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    this.methodCounts.set(method, (this.methodCounts.get(method) ?? 0) + 1);
    if (method !== "read") {
      const detail =
        method === "write" && typeof params.data === "string"
          ? ` bytes=${Math.floor((params.data.length * 3) / 4)}`
          : method === "setSignals"
            ? ` ${JSON.stringify(params)}`
            : "";
      this.trace.push(`${this.elapsed()} request ${id} ${method}${detail}`);
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  summary() {
    return this.trace.join("\n");
  }

  calls(method: string) {
    return this.methodCounts.get(method) ?? 0;
  }

  private elapsed() {
    return `${Math.round(performance.now() - this.startedAt)}ms`;
  }

  async stop() {
    await this.request("close").catch(() => undefined);
    this.child.stdin.end();
  }
}

test.describe("Web Serial real-hardware probe reliability", () => {
  test.skip(
    !serialPath || !expectedDeviceId || !expectedMac,
    "Set the explicit HIL serial path, device id, and MAC to run this test.",
  );
  test.describe.configure({ mode: "serial" });

  test("confirms the exact target within five seconds repeatedly", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const bridge = new SerialBridge(serialPath as string);
    await page.exposeFunction("__hilSerialOpen", (baudRate: number) =>
      bridge.request("open", { baudRate }),
    );
    await page.exposeFunction("__hilSerialClose", () =>
      bridge.request("close"),
    );
    await page.exposeFunction("__hilSerialWrite", (data: string) =>
      bridge.request("write", { data }),
    );
    await page.exposeFunction("__hilSerialRead", () =>
      bridge.request("read", { maxBytes: 4096 }),
    );
    await page.exposeFunction(
      "__hilSerialSetSignals",
      (signals: { dataTerminalReady?: boolean; requestToSend?: boolean }) =>
        bridge.request("setSignals", signals),
    );
    await page.addInitScript(() => {
      const host = window as typeof window & {
        __hilSerialOpen(baudRate: number): Promise<void>;
        __hilSerialClose(): Promise<void>;
        __hilSerialWrite(data: string): Promise<void>;
        __hilSerialRead(): Promise<string>;
        __hilSerialSetSignals(signals: {
          dataTerminalReady?: boolean;
          requestToSend?: boolean;
        }): Promise<void>;
      };
      const decodeBase64 = (value: string) => {
        const binary = atob(value);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
      };
      const encodeBase64 = (value: Uint8Array) => {
        let binary = "";
        for (const byte of value) {
          binary += String.fromCharCode(byte);
        }
        return btoa(binary);
      };
      let opened = false;
      const port = {
        readable: null as ReadableStream<Uint8Array> | null,
        writable: null as WritableStream<Uint8Array> | null,
        getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
        open: async ({ baudRate }: { baudRate: number }) => {
          await host.__hilSerialOpen(baudRate);
          opened = true;
          port.readable = new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (!opened) {
                return;
              }
              const payload = await host.__hilSerialRead();
              if (payload && opened) {
                controller.enqueue(decodeBase64(payload));
              }
            },
            cancel() {
              opened = false;
            },
          });
          port.writable = new WritableStream<Uint8Array>({
            write(chunk) {
              return host.__hilSerialWrite(encodeBase64(chunk));
            },
          });
        },
        close: async () => {
          opened = false;
          await host.__hilSerialClose();
          port.readable = null;
          port.writable = null;
        },
        setSignals: (signals: {
          dataTerminalReady?: boolean;
          requestToSend?: boolean;
        }) => host.__hilSerialSetSignals(signals),
      };
      Object.defineProperty(navigator, "serial", {
        configurable: true,
        value: {
          getPorts: async () => [port],
          requestPort: async () => port,
        },
      });
    });

    try {
      const durations: number[] = [];
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const startedAt = performance.now();
        if (attempt === 0) {
          await page.goto("/flash");
        } else {
          await page.reload();
        }
        await expect(page.getByText("Confirmed", { exact: true })).toBeVisible({
          timeout: 4_900,
        });
        const duration = performance.now() - startedAt;
        durations.push(duration);
        expect(duration).toBeLessThan(5_000);
        await expect(
          page.getByText(expectedDeviceId as string, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(expectedMac as string, { exact: false }),
        ).toBeVisible();
      }
      expect(bridge.calls("setSignals")).toBe(0);
      console.log(`WEB_SERIAL_HIL_DURATIONS_MS=${durations.join(",")}`);
    } catch (error) {
      console.log(`WEB_SERIAL_HIL_TRACE\n${bridge.summary()}`);
      throw error;
    } finally {
      await bridge.stop();
    }
  });
});
