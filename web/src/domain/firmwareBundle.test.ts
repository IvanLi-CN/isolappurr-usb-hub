import { describe, expect, test } from "bun:test";

import {
  emptyBundledFirmwareManifest,
  parseBundledFirmwareManifest,
} from "./firmwareBundle";

describe("parseBundledFirmwareManifest", () => {
  test("falls back to an empty manifest for invalid payloads", () => {
    expect(parseBundledFirmwareManifest(null)).toEqual(
      emptyBundledFirmwareManifest(),
    );
  });

  test("keeps valid bundled releases and drops malformed entries", () => {
    const parsed = parseBundledFirmwareManifest({
      schemaVersion: "1",
      repo: "IvanLi-CN/isolappurr-usb-hub",
      generatedAt: "2026-07-08T00:00:00Z",
      releaseCount: 2,
      recoveryTags: ["v0.5.1"],
      releases: [
        {
          tagName: "v0.5.1",
          version: "v0.5.1",
          publishedAt: "2026-07-06T13:09:22Z",
          prerelease: false,
          catalogPath:
            "/firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
          app: {
            artifactId: "isolapurr-demo-051",
            assetPath: "/firmware/releases/v0.5.1/isolapurr-usb-hub.app.bin",
            fileName: "isolapurr-usb-hub.app.bin",
            fileKind: "app_bin",
            flashAddress: 0x10000,
          },
          recovery: {
            artifactId: "isolapurr-demo-051-recovery",
            assetPath: "/firmware/releases/v0.5.1/isolapurr-usb-hub.elf",
            fileName: "isolapurr-usb-hub.elf",
            fileKind: "elf",
            flashAddress: 0,
          },
        },
        {
          tagName: "",
          version: "broken",
          publishedAt: "2026-07-05T00:00:00Z",
          app: {},
        },
      ],
    });

    expect(parsed.releases).toHaveLength(1);
    expect(parsed.releases[0]?.tagName).toBe("v0.5.1");
    expect(parsed.releases[0]?.recovery?.flashAddress).toBe(0);
    expect(parsed.releases[0]?.recovery?.fileKind).toBe("elf");
  });
});
