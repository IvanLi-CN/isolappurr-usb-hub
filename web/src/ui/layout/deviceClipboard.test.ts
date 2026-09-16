import { afterEach, describe, expect, test } from "bun:test";
import {
  formatDeviceClipboardContent,
  writeDeviceClipboard,
} from "./deviceClipboard";

const originalClipboardItem = globalThis.ClipboardItem;
const originalNavigatorClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: originalClipboardItem,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalNavigatorClipboard,
  });
});

describe("device clipboard content", () => {
  test("formats one-line plain text and markdown with the complete identity", () => {
    expect(
      formatDeviceClipboardContent({
        deviceName: "Bench\nHub",
        deviceId: " AABBCC001122 ",
        connection: "Wi-Fi / LAN",
      }),
    ).toEqual({
      plainText:
        "Device name: Bench Hub, Device ID: aabbcc001122, Connection: Wi-Fi / LAN",
      markdown:
        "**Device name:** Bench Hub, **Device ID:** `aabbcc001122`, **Connection:** Wi-Fi / LAN",
    });
  });

  test("writes both clipboard MIME types when supported", async () => {
    let item: Record<string, Blob> | undefined;
    let written: unknown[] | undefined;
    class TestClipboardItem {
      static supports(type: string) {
        return type === "text/markdown";
      }

      constructor(data: Record<string, Blob>) {
        item = data;
      }
    }
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (values: unknown[]) => {
          written = values;
        },
        writeText: async () => {
          throw new Error("writeText should not be used");
        },
      },
    });

    const content = formatDeviceClipboardContent({
      deviceName: "Bench Hub",
      deviceId: "aabbcc001122",
      connection: "Web Serial",
    });
    await writeDeviceClipboard(content);

    expect(written).toHaveLength(1);
    expect(item && Object.keys(item)).toEqual(["text/plain", "text/markdown"]);
    expect(await item?.["text/plain"].text()).toBe(content.plainText);
    expect(await item?.["text/markdown"].text()).toBe(content.markdown);
  });

  test("falls back to plain text when markdown is unsupported", async () => {
    let plainText: string | undefined;
    class UnsupportedClipboardItem {
      constructor(data: Record<string, Blob>) {
        void data;
      }

      static supports() {
        return false;
      }
    }
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: UnsupportedClipboardItem,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          plainText = value;
        },
      },
    });

    const content = formatDeviceClipboardContent({
      deviceName: "Bench Hub",
      deviceId: "aabbcc001122",
      connection: "Not connected",
    });
    await writeDeviceClipboard(content);

    expect(plainText).toBe(content.plainText);
  });
});
