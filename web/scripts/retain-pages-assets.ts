import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

type ReleaseMetadata = {
  id: string;
  createdAt: string;
};

type GitHubReleaseMetadata = ReleaseMetadata & {
  webDistUrl: string;
};

type RetainedReleaseSource = AssetRetentionRelease | GitHubReleaseMetadata;

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

function normalizeReleaseMetadata(candidate: unknown): ReleaseMetadata | null {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as { id?: unknown }).id !== "string" ||
    typeof (candidate as { createdAt?: unknown }).createdAt !== "string"
  ) {
    return null;
  }

  const createdAt = (candidate as { createdAt: string }).createdAt;
  if (parseDate(createdAt) === null) {
    return null;
  }

  return {
    id: (candidate as { id: string }).id,
    createdAt,
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

function selectRetainedReleaseMetadata(
  releases: ReleaseMetadata[],
  nowIso: string,
  maxReleaseCount = MAX_RELEASE_COUNT,
  maxAgeDays = MAX_AGE_DAYS,
): ReleaseMetadata[] {
  const now = parseDate(nowIso);
  if (now === null) {
    throw new Error(`Invalid retention date: ${nowIso}`);
  }

  const sorted = releases
    .map((release) => normalizeReleaseMetadata(release))
    .filter((release): release is ReleaseMetadata => release !== null)
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

async function downloadRetainedAssetFromOrigin(
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

async function downloadAndExtractReleaseAssets(
  webDistUrl: string,
  githubToken: string | undefined,
): Promise<{ assetPaths: string[]; sourceDir: string }> {
  const headers: Record<string, string> = {
    cache: "no-cache",
    "cache-control": "no-cache",
  };
  if (githubToken) {
    headers.Accept = "application/octet-stream";
    headers.Authorization = `Bearer ${githubToken}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
  }

  const response = await fetch(webDistUrl, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to download release web dist (${response.status})`);
  }

  const sourceDir = await mkdtemp(join(tmpdir(), "isolapurr-retain-"));
  const archivePath = resolve(sourceDir, "release-web-dist.tar.gz");
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  await execFileAsync("tar", ["-xzf", archivePath, "-C", sourceDir]);
  const assetPaths = await collectCurrentAssetPaths(sourceDir);
  return { assetPaths, sourceDir };
}

async function fetchGitHubReleaseMetadata(
  repo: string,
  token: string,
): Promise<GitHubReleaseMetadata[]> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch GitHub releases (${response.status})`);
  }

  const releases = (await response.json()) as Array<{
    assets?: Array<{
      browser_download_url?: string;
      name?: string;
      url?: string;
    }>;
    created_at?: string;
    draft?: boolean;
    prerelease?: boolean;
    published_at?: string | null;
    target_commitish?: string;
    tag_name?: string;
  }>;

  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => {
      const asset = release.assets?.find(
        (candidate) =>
          typeof candidate?.name === "string" &&
          candidate.name.startsWith("isolapurr-web-dist-") &&
          candidate.name.endsWith(".tar.gz") &&
          (typeof candidate.url === "string" ||
            typeof candidate.browser_download_url === "string"),
      );
      const publishedAt = release.published_at ?? release.created_at;
      if (!asset || !publishedAt) {
        return [];
      }

      const releaseId =
        typeof release.target_commitish === "string" &&
        /^[0-9a-f]{12,40}$/i.test(release.target_commitish)
          ? release.target_commitish.slice(0, 12)
          : (release.tag_name ?? asset.name);

      return [
        {
          id: releaseId,
          createdAt: publishedAt,
          webDistUrl: asset.url ?? (asset.browser_download_url as string),
        },
      ];
    });
}

async function fetchLiveRetentionSources(
  siteOrigin: string,
  buildDate: string,
): Promise<AssetRetentionRelease[]> {
  return (
    (await fetchPreviousManifest(siteOrigin))?.releases ??
    (await bootstrapPreviousRelease(siteOrigin, buildDate))
  );
}

export async function retainPreviousAssets({
  buildDate,
  buildSha,
  distDir,
  siteOrigin,
}: AssetRetentionConfig): Promise<AssetRetentionManifest> {
  const currentAssets = await collectCurrentAssetPaths(distDir);
  const githubRepository = process.env.GITHUB_REPOSITORY?.trim();
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  const githubReleases =
    githubRepository && githubToken
      ? await fetchGitHubReleaseMetadata(githubRepository, githubToken)
      : [];
  const previousReleases =
    githubRepository && githubToken && githubReleases.length > 0
      ? githubReleases
      : await fetchLiveRetentionSources(siteOrigin, buildDate);

  const currentRelease: AssetRetentionRelease = {
    id: buildSha.slice(0, 12),
    createdAt: buildDate,
    assets: currentAssets,
  };

  const retainedMetadata = selectRetainedReleaseMetadata(
    [
      currentRelease,
      ...previousReleases.map((release) => ({
        id: release.id,
        createdAt: release.createdAt,
      })),
    ],
    buildDate,
  );

  const retainedReleaseById = new Map<string, RetainedReleaseSource>();
  retainedReleaseById.set(currentRelease.id, currentRelease);
  for (const release of previousReleases) {
    retainedReleaseById.set(release.id, release);
  }

  const currentAssetSet = new Set(currentAssets);
  for (const release of retainedMetadata) {
    if (release.id === currentRelease.id) {
      continue;
    }

    const retainedRelease = retainedReleaseById.get(release.id);
    if (!retainedRelease) {
      continue;
    }

    if ("webDistUrl" in retainedRelease) {
      const { assetPaths, sourceDir } = await downloadAndExtractReleaseAssets(
        retainedRelease.webDistUrl,
        githubToken,
      );
      retainedReleaseById.set(release.id, {
        id: retainedRelease.id,
        createdAt: retainedRelease.createdAt,
        assets: assetPaths,
      });
      for (const assetPath of assetPaths) {
        if (currentAssetSet.has(assetPath)) {
          continue;
        }
        const source = resolve(sourceDir, assetPath);
        const destination = resolve(distDir, assetPath);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(source, destination);
        currentAssetSet.add(assetPath);
      }
      await rm(sourceDir, { force: true, recursive: true });
      continue;
    }

    for (const assetPath of retainedRelease.assets) {
      if (currentAssetSet.has(assetPath)) {
        continue;
      }
      await downloadRetainedAssetFromOrigin(distDir, siteOrigin, assetPath);
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
    releases: retainedMetadata.map((release) => {
      const materialized = retainedReleaseById.get(release.id);
      return {
        id: release.id,
        createdAt: release.createdAt,
        assets:
          materialized && "assets" in materialized
            ? materialized.assets
            : currentAssets,
      };
    }),
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
