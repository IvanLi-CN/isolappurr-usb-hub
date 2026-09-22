import { describe, expect, test } from "bun:test";

import { WebSerialJsonlTransport } from "./webSerialFirmware";

describe("WebSerialJsonlTransport dispatch guards", () => {
  test("does not write a queued request after its dispatch guard rejects it", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let notifyFirstWrite: (() => void) | null = null;
    const firstWrite = new Promise<void>((resolve) => {
      notifyFirstWrite = resolve;
    });
    const writtenIds: number[] = [];
    const port: {
      readable: ReadableStream<Uint8Array> | null;
      writable: WritableStream<Uint8Array> | null;
      open: () => Promise<void>;
      close: () => Promise<void>;
    } = {
      readable: null,
      writable: null,
      open: async () => {
        port.readable = new ReadableStream<Uint8Array>({
          start(streamController) {
            controller = streamController;
          },
        });
        port.writable = new WritableStream<Uint8Array>({
          write(chunk) {
            const request = JSON.parse(new TextDecoder().decode(chunk)) as {
              id: number;
            };
            writtenIds.push(request.id);
            if (request.id === 1) {
              notifyFirstWrite?.();
            } else {
              controller?.enqueue(
                new TextEncoder().encode(
                  `${JSON.stringify({ id: request.id, result: {} })}\n`,
                ),
              );
            }
          },
        });
      },
      close: async () => undefined,
    };
    const transport = new WebSerialJsonlTransport();
    await transport.connectToPort(port as never);

    try {
      const first = transport.request({
        id: 1,
        method: "ports.get",
        timeoutMs: 5_000,
      });
      await firstWrite;
      let ownsLease = true;
      let guardCalls = 0;
      const second = transport.request(
        { id: 2, method: "power.config_set", timeoutMs: 1_000 },
        {
          beforeDispatch: () => {
            guardCalls += 1;
            return ownsLease;
          },
        },
      );
      ownsLease = false;
      expect(guardCalls).toBe(0);

      controller?.enqueue(
        new TextEncoder().encode(`${JSON.stringify({ id: 1, result: {} })}\n`),
      );
      await first;
      await expect(second).rejects.toThrow("dispatch guard");
      expect(guardCalls).toBe(1);
      expect(writtenIds).toEqual([1]);
    } finally {
      await transport.disconnect();
    }
  });
});
