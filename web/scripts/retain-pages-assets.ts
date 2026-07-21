import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const MAX_RELEASE_COUNT = 2;
const MAX_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AssetRetentionRelease = {
  assets: string[];
  createdAt: string;
  id: string;
};

export type AssetRetentionManifest = {
  generatedAt: string;
  policy: {
    maxAgeDays: number;
    maxReleaseCount: number;
  };
  releases: AssetRetentionRelease[];
  schemaVersion: 1;
};

type AssetRetentionConfig = {
  buildDate: string;
  buildSha: string;
  distDir: string;
  siteOrigin: string;
};

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter(Boolean))].sort();
}

function parseDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function normalizeRelease(candidate: unknown): AssetRetentionRelease | null {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as { id?: unknown }).id !== "string" ||
    typeof (candidate as { createdAt?: unknown }).createdAt !== "string" ||
    !Array.isArray((candidate as { assets?: unknown }).assets)
  ) {
    return null;
  }

  const createdAt = (candidate as { createdAt: string }).createdAt;
  if (parseDate(createdAt) === null) {
    return null;
  }

  const assets = uniqueSorted(
    (candidate as { assets: unknown[] }).assets
      .filter((asset): asset is string => typeof asset === "string")
      .map((asset) => asset.replace(/^\/+/, "").split("?")[0] ?? "")
      .filter((asset) => asset.startsWith("assets/")),
  );

  if (assets.length === 0) {
    return null;
  }

  return {
    id: (candidate as { id: string }).id,
    createdAt,
    assets,
  };
}

export function extractAssetUrlsFromServiceWorker(source: string): string[] {
  const matches = source.matchAll(/"url":"([^"]+)"/g);
  const assets: string[] = [];
  for (const match of matches) {
    const asset = match[1]?.replace(/^\/+/, "").split("?")[0];
    if (asset?.startsWith("assets/")) {
      assets.push(asset);
    }
  }
  return uniqueSorted(assets);
}

export function selectRetainedReleases(
  releases: AssetRetentionRelease[],
  nowIso: string,
  maxReleaseCount = MAX_RELEASE_COUNT,
  maxAgeDays = MAX_AGE_DAYS,
): AssetRetentionRelease[] {
  const now = parseDate(nowIso);
  if (now === null) {
    throw new Error(`Invalid retention date: ${nowIso}`);
  }

  const sorted = releases
    .map((release) => normalizeRelease(release))
    .filter((release): release is AssetRetentionRelease => release !== null)
    .sort((left, right) => {
      const leftTime = parseDate(left.createdAt) ?? 0;
      const rightTime = parseDate(right.createdAt) ?? 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return left.id.localeCompare(right.id);
    });

  return sorted.filter((release, index) => {
    if (index < maxReleaseCount) {
      return true;
    }
    const createdAt = parseDate(release.createdAt);
    if (createdAt === null) {
      return false;
    }
    return now - createdAt <= maxAgeDays * DAY_MS;
  });
}

export function resolveBuildDate(
  input: string | undefined,
  now: Date = new Date(),
): string {
  const trimmed = input?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : now.toISOString();
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function collectCurrentAssetPaths(
  distDir: string,
): Promise<string[]> {
  const assetsDir = resolve(distDir, "assets");
  const assetsDirStat = await stat(assetsDir).catch(() => null);
  if (!assetsDirStat?.isDirectory()) {
    return [];
  }

  const files = await listFiles(assetsDir);
  return uniqueSorted(files.map((file) => toPosix(relative(distDir, file))));
}

async function fetchPreviousManifest(
  siteOrigin: string,
): Promise<AssetRetentionManifest | null> {
  const response = await fetch(
    new URL("asset-retention.json", `${siteOrigin}/`),
    {
      headers: {
        cache: "no-cache",
        "cache-control": "no-cache",
      },
    },
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch live asset-retention.json (${response.status})`,
    );
  }

  const manifest = (await response.json()) as Partial<AssetRetentionManifest>;
  const releases = Array.isArray(manifest.releases)
    ? manifest.releases
        .map((release) => normalizeRelease(release))
        .filter((release): release is AssetRetentionRelease => release !== null)
    : [];

  return {
    schemaVersion: 1,
    generatedAt:
      typeof manifest.generatedAt === "string"
        ? manifest.generatedAt
        : new Date().toISOString(),
    policy: {
      maxAgeDays:
        typeof manifest.policy?.maxAgeDays === "number"
          ? manifest.policy.maxAgeDays
          : MAX_AGE_DAYS,
      maxReleaseCount:
        typeof manifest.policy?.maxReleaseCount === "number"
          ? manifest.policy.maxReleaseCount
          : MAX_RELEASE_COUNT,
    },
    releases,
  };
}

async function bootstrapPreviousRelease(
  siteOrigin: string,
  buildDate: string,
): Promise<AssetRetentionRelease[]> {
  const response = await fetch(new URL("sw.js", `${siteOrigin}/`), {
    headers: {
      cache: "no-cache",
      "cache-control": "no-cache",
    },
  });

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch live sw.js (${response.status})`);
  }

  const assets = extractAssetUrlsFromServiceWorker(await response.text());
  if (assets.length === 0) {
    return [];
  }

  return [
    {
      id: "bootstrap-live-site",
      createdAt: buildDate,
      assets,
    },
  ];
}

async function downloadRetainedAsset(
  distDir: string,
  siteOrigin: string,
  assetPath: string,
): Promise<void> {
  const response = await fetch(new URL(assetPath, `${siteOrigin}/`), {
    headers: {
      cache: "no-cache",
      "cache-control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to retain live asset ${assetPath} (${response.status})`,
    );
  }

  const destination = resolve(distDir, assetPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function retainPreviousAssets({
  buildDate,
  buildSha,
  distDir,
  siteOrigin,
}: AssetRetentionConfig): Promise<AssetRetentionManifest> {
  const currentAssets = await collectCurrentAssetPaths(distDir);
  const previousManifest = await fetchPreviousManifest(siteOrigin);
  const previousReleases =
    previousManifest?.releases ??
    (await bootstrapPreviousRelease(siteOrigin, buildDate));

  const currentRelease: AssetRetentionRelease = {
    id: buildSha.slice(0, 12),
    createdAt: buildDate,
    assets: currentAssets,
  };

  const retainedReleases = selectRetainedReleases(
    [currentRelease, ...previousReleases],
    buildDate,
  );

  const currentAssetSet = new Set(currentAssets);
  for (const release of retainedReleases) {
    if (release.id === currentRelease.id) {
      continue;
    }

    for (const assetPath of release.assets) {
      if (currentAssetSet.has(assetPath)) {
        continue;
      }
      await downloadRetainedAsset(distDir, siteOrigin, assetPath);
      currentAssetSet.add(assetPath);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: buildDate,
    policy: {
      maxAgeDays: MAX_AGE_DAYS,
      maxReleaseCount: MAX_RELEASE_COUNT,
    },
    releases: retainedReleases,
  };
}

async function main() {
  const rootDir = resolve(import.meta.dir, "..");
  const distDir = resolve(rootDir, "dist");
  const buildDate = resolveBuildDate(process.env.VITE_BUILD_DATE);
  const buildSha = process.env.VITE_BUILD_SHA ?? "local-build";
  const siteOrigin = process.env.PAGES_DEPLOY_ORIGIN?.trim();

  if (!siteOrigin) {
    throw new Error("Missing PAGES_DEPLOY_ORIGIN for Pages asset retention");
  }

  const manifest = await retainPreviousAssets({
    buildDate,
    buildSha,
    distDir,
    siteOrigin,
  });

  await writeFile(
    resolve(distDir, "asset-retention.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

if (import.meta.main) {
  await main();
}
