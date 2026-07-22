import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  extractAssetUrlsFromServiceWorker,
  resolveBuildDate,
  retainPreviousAssets,
  selectRetainedReleases,
} from "./retain-pages-assets";

const execFileAsync = promisify(execFile);

describe("extractAssetUrlsFromServiceWorker", () => {
  test("keeps only unique asset paths from the Workbox manifest", () => {
    const swSource =
      'precacheAndRoute([{"revision":"1","url":"assets/index-abc.js"},{"revision":"2","url":"assets/index-abc.js"},{"revision":"3","url":"/assets/index-def.css"},{"revision":"4","url":"icons/pwa-192.png"}]);';

    expect(extractAssetUrlsFromServiceWorker(swSource)).toEqual([
      "assets/index-abc.js",
      "assets/index-def.css",
    ]);
  });
});

describe("retainPreviousAssets", () => {
  test("materializes retained assets from GitHub release web dist archives", async () => {
    const originalFetch = globalThis.fetch;
    const originalRepository = process.env.GITHUB_REPOSITORY;
    const originalToken = process.env.GITHUB_TOKEN;
    const tempRoot = await mkdtemp(join(tmpdir(), "isolapurr-retain-test-"));
    const distDir = resolve(tempRoot, "dist");
    const releaseDistDir = resolve(tempRoot, "release-dist");
    const archivePath = resolve(tempRoot, "previous-web-dist.tar.gz");

    await mkdir(resolve(distDir, "assets"), { recursive: true });
    await writeFile(resolve(distDir, "assets/index-current.js"), "current");
    await mkdir(resolve(releaseDistDir, "assets"), { recursive: true });
    await writeFile(resolve(releaseDistDir, "assets/index-old.js"), "old");
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "-C",
      releaseDistDir,
      ".",
    ]);

    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (
        url === "https://api.github.com/repos/owner/repo/releases?per_page=100"
      ) {
        return new Response(
          JSON.stringify([
            {
              assets: [
                {
                  name: "isolapurr-web-dist-v0.6.0.tar.gz",
                  url: "https://api.github.com/repos/owner/repo/releases/assets/1",
                },
              ],
              created_at: "2026-07-20T00:00:00Z",
              draft: false,
              prerelease: false,
              published_at: "2026-07-20T00:00:00Z",
              target_commitish: "de112a125eb60000000000000000000000000000",
              tag_name: "v0.6.0",
            },
          ]),
          { status: 200 },
        );
      }
      if (url === "https://api.github.com/repos/owner/repo/releases/assets/1") {
        return new Response(await readFile(archivePath), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const manifest = await retainPreviousAssets({
        buildDate: "2026-07-22T00:00:00Z",
        buildSha: "currentsha000000000000000000000000000000000",
        distDir,
        siteOrigin: "https://live.example",
      });

      expect(manifest.releases.map((release) => release.id)).toEqual([
        "currentsha00",
        "de112a125eb6",
      ]);
      expect(await stat(resolve(distDir, "assets/index-old.js"))).toBeTruthy();
      expect(
        manifest.releases.find((release) => release.id === "de112a125eb6")
          ?.assets,
      ).toEqual(["assets/index-old.js"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRepository === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepository;
      }
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  test("does not treat archived retained assets as release-owned assets", async () => {
    const originalFetch = globalThis.fetch;
    const originalRepository = process.env.GITHUB_REPOSITORY;
    const originalToken = process.env.GITHUB_TOKEN;
    const tempRoot = await mkdtemp(join(tmpdir(), "isolapurr-retain-test-"));
    const distDir = resolve(tempRoot, "dist");
    const releaseDistDir = resolve(tempRoot, "release-dist");
    const archivePath = resolve(tempRoot, "previous-web-dist.tar.gz");

    await mkdir(resolve(distDir, "assets"), { recursive: true });
    await writeFile(resolve(distDir, "assets/index-current.js"), "current");
    await mkdir(resolve(releaseDistDir, "assets"), { recursive: true });
    await writeFile(resolve(releaseDistDir, "assets/index-release.js"), "old");
    await writeFile(
      resolve(releaseDistDir, "assets/index-grandparent.js"),
      "grandparent",
    );
    await writeFile(
      resolve(releaseDistDir, "asset-retention.json"),
      JSON.stringify({
        generatedAt: "2026-07-21T00:00:00Z",
        policy: {
          maxAgeDays: 14,
          maxReleaseCount: 2,
        },
        releases: [
          {
            assets: ["assets/index-release.js"],
            createdAt: "2026-07-21T00:00:00Z",
            id: "ab12cd34ef56",
          },
          {
            assets: ["assets/index-grandparent.js"],
            createdAt: "2026-07-08T00:00:00Z",
            id: "grandpa00000",
          },
        ],
        schemaVersion: 1,
      }),
    );
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "-C",
      releaseDistDir,
      ".",
    ]);

    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (
        url === "https://api.github.com/repos/owner/repo/releases?per_page=100"
      ) {
        return new Response(
          JSON.stringify([
            {
              assets: [
                {
                  name: "isolapurr-web-dist-v0.6.2.tar.gz",
                  url: "https://api.github.com/repos/owner/repo/releases/assets/2",
                },
              ],
              created_at: "2026-07-21T00:00:00Z",
              draft: false,
              prerelease: false,
              published_at: "2026-07-21T00:00:00Z",
              target_commitish: "ab12cd34ef560000000000000000000000000000",
              tag_name: "v0.6.2",
            },
          ]),
          { status: 200 },
        );
      }
      if (url === "https://api.github.com/repos/owner/repo/releases/assets/2") {
        return new Response(await readFile(archivePath), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const manifest = await retainPreviousAssets({
        buildDate: "2026-07-22T00:00:00Z",
        buildSha: "currentsha000000000000000000000000000000000",
        distDir,
        siteOrigin: "https://live.example",
      });

      expect(manifest.releases.map((release) => release.id)).toEqual([
        "currentsha00",
        "ab12cd34ef56",
      ]);
      expect(
        await stat(resolve(distDir, "assets/index-release.js")),
      ).toBeTruthy();
      const copiedGrandparent = await stat(
        resolve(distDir, "assets/index-grandparent.js"),
      ).then(
        () => true,
        () => false,
      );
      expect(copiedGrandparent).toBe(false);
      expect(
        manifest.releases.find((release) => release.id === "ab12cd34ef56")
          ?.assets,
      ).toEqual(["assets/index-release.js"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRepository === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepository;
      }
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });

  test("falls back to live manifest when release web dist assets are absent", async () => {
    const originalFetch = globalThis.fetch;
    const originalRepository = process.env.GITHUB_REPOSITORY;
    const originalToken = process.env.GITHUB_TOKEN;
    const tempRoot = await mkdtemp(join(tmpdir(), "isolapurr-retain-test-"));
    const distDir = resolve(tempRoot, "dist");

    await mkdir(resolve(distDir, "assets"), { recursive: true });
    await writeFile(resolve(distDir, "assets/index-current.js"), "current");

    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (
        url === "https://api.github.com/repos/owner/repo/releases?per_page=100"
      ) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url === "https://live.example/asset-retention.json") {
        return new Response(
          JSON.stringify({
            generatedAt: "2026-07-21T00:00:00Z",
            policy: {
              maxAgeDays: 14,
              maxReleaseCount: 2,
            },
            releases: [
              {
                assets: ["assets/index-live-old.js"],
                createdAt: "2026-07-21T00:00:00Z",
                id: "liveold000000",
              },
            ],
            schemaVersion: 1,
          }),
          { status: 200 },
        );
      }
      if (url === "https://live.example/assets/index-live-old.js") {
        return new Response("live-old", { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    try {
      const manifest = await retainPreviousAssets({
        buildDate: "2026-07-22T00:00:00Z",
        buildSha: "currentsha000000000000000000000000000000000",
        distDir,
        siteOrigin: "https://live.example",
      });

      expect(manifest.releases.map((release) => release.id)).toEqual([
        "currentsha00",
        "liveold000000",
      ]);
      expect(
        await stat(resolve(distDir, "assets/index-live-old.js")),
      ).toBeTruthy();
      expect(
        manifest.releases.find((release) => release.id === "liveold000000")
          ?.assets,
      ).toEqual(["assets/index-live-old.js"]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalRepository === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = originalRepository;
      }
      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    }
  });
});

describe("selectRetainedReleases", () => {
  test("keeps the newest two releases and any still within the age window", () => {
    const releases = [
      {
        id: "fresh-a",
        createdAt: "2026-07-19T00:00:00Z",
        assets: ["assets/index-a.js"],
      },
      {
        id: "fresh-b",
        createdAt: "2026-07-18T00:00:00Z",
        assets: ["assets/index-b.js"],
      },
      {
        id: "fresh-c",
        createdAt: "2026-07-10T00:00:00Z",
        assets: ["assets/index-c.js"],
      },
      {
        id: "expired-d",
        createdAt: "2026-06-15T00:00:00Z",
        assets: ["assets/index-d.js"],
      },
    ];

    expect(
      selectRetainedReleases(releases, "2026-07-19T12:00:00Z").map(
        (release) => release.id,
      ),
    ).toEqual(["fresh-a", "fresh-b", "fresh-c"]);
  });
});

describe("resolveBuildDate", () => {
  test("falls back to now when the workflow passes an empty build date", () => {
    const now = new Date("2026-07-21T09:20:23Z");

    expect(resolveBuildDate("", now)).toBe("2026-07-21T09:20:23.000Z");
    expect(resolveBuildDate("   ", now)).toBe("2026-07-21T09:20:23.000Z");
  });

  test("keeps an explicit build date unchanged", () => {
    expect(resolveBuildDate("2026-07-21T09:20:23Z")).toBe(
      "2026-07-21T09:20:23Z",
    );
  });
});
