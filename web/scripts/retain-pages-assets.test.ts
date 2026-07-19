import { describe, expect, test } from "bun:test";

import {
  extractAssetUrlsFromServiceWorker,
  selectRetainedReleases,
} from "./retain-pages-assets";

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
