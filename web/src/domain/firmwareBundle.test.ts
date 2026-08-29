import { describe, expect, test } from "bun:test";

import {
  emptyBundledFirmwareManifest,
  loadBundledFirmwareManifest,
  parseBundledFirmwareManifest,
  validateBundledArtifactCompatibility,
} from "./firmwareBundle";

const catalogV2 = {
  schemaVersion: "2",
  artifacts: [
    {
      artifactId: "fusb-app",
      compiledProfile: "tps-fusb",
      compatibleHardware: { discoverySchema: 1, profiles: ["tps-fusb"] },
    },
  ],
};

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
            assetPath: "/firmware/releases/v0.5.1/isolapurr-usb-hub.full.bin",
            fileName: "isolapurr-usb-hub.full.bin",
            fileKind: "full_image",
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
    expect(parsed.releases[0]?.recovery?.fileKind).toBe("full_image");
  });

  test("keeps profile-specific assets for multi-board releases", () => {
    const parsed = parseBundledFirmwareManifest({
      schemaVersion: "1",
      releases: [
        {
          tagName: "v-next",
          version: "v-next",
          publishedAt: "2026-08-29T00:00:00Z",
          catalogPath: "/firmware/releases/v-next/catalog.json",
          app: {
            artifactId: "sw-app",
            assetPath: "/firmware/releases/v-next/sw.app.bin",
            fileName: "sw.app.bin",
            fileKind: "app_bin",
            flashAddress: 0x10000,
          },
          profiles: {
            "tps-fusb": {
              app: {
                artifactId: "fusb-app",
                assetPath: "/firmware/releases/v-next/fusb.app.bin",
                fileName: "fusb.app.bin",
                fileKind: "app_bin",
                flashAddress: 0x10000,
              },
            },
          },
        },
      ],
    });
    expect(parsed.releases[0]?.profiles?.["tps-fusb"]?.app.artifactId).toBe(
      "fusb-app",
    );
  });
});

describe("loadBundledFirmwareManifest", () => {
  test("loads the release manifest through a cache-busted network URL first", async () => {
    const requestedUrls: string[] = [];

    const manifest = await loadBundledFirmwareManifest({
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return Response.json({
          schemaVersion: "1",
          repo: "IvanLi-CN/isolappurr-usb-hub",
          generatedAt: "2026-07-22T00:00:00Z",
          releases: [],
        });
      },
      now: () => 1234,
    });

    expect(manifest.generatedAt).toBe("2026-07-22T00:00:00Z");
    expect(requestedUrls).toEqual([
      "/firmware/releases-manifest.json?refresh=1234",
    ]);
  });

  test("falls back to the stable manifest URL for offline PWA caches", async () => {
    const requestedUrls: string[] = [];

    const manifest = await loadBundledFirmwareManifest({
      fetchImpl: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("?refresh=")) {
          throw new TypeError("offline");
        }
        return Response.json({
          schemaVersion: "1",
          repo: "IvanLi-CN/isolappurr-usb-hub",
          generatedAt: "2026-07-21T00:00:00Z",
          releases: [],
        });
      },
      now: () => 5678,
    });

    expect(manifest.generatedAt).toBe("2026-07-21T00:00:00Z");
    expect(requestedUrls).toEqual([
      "/firmware/releases-manifest.json?refresh=5678",
      "/firmware/releases-manifest.json",
    ]);
  });
});

describe("validateBundledArtifactCompatibility", () => {
  test("accepts only a verified matching physical profile", () => {
    expect(() =>
      validateBundledArtifactCompatibility(catalogV2, "fusb-app", {
        discoveryState: "verified",
        detectedProfile: "tps-fusb",
      }),
    ).not.toThrow();
  });

  test("blocks unknown, conflicting, legacy, and mismatched artifacts", () => {
    for (const hardware of [
      { discoveryState: "unknown", detectedProfile: undefined },
      { discoveryState: "conflicting", detectedProfile: undefined },
      { discoveryState: "verified", detectedProfile: "tps-sw" },
    ]) {
      expect(() =>
        validateBundledArtifactCompatibility(catalogV2, "fusb-app", hardware),
      ).toThrow();
    }
    expect(() =>
      validateBundledArtifactCompatibility(
        { schemaVersion: "1", artifacts: [] },
        "fusb-app",
        { discoveryState: "verified", detectedProfile: "tps-fusb" },
      ),
    ).toThrow();
  });
});
