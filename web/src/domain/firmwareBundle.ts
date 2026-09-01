export type BundledFirmwareAsset = {
  artifactId: string;
  assetPath: string;
  fileName: string;
  fileKind: string;
  flashAddress: number;
  sha256?: string;
  size?: number;
};

export type BundledFirmwareRelease = {
  tagName: string;
  version: string;
  publishedAt: string;
  prerelease: boolean;
  catalogPath: string;
  app: BundledFirmwareAsset;
  recovery?: BundledFirmwareAsset | null;
  profiles?: Record<
    string,
    {
      app: BundledFirmwareAsset;
      recovery?: BundledFirmwareAsset | null;
    }
  >;
};

export type BundledFirmwareManifest = {
  schemaVersion: string;
  repo: string;
  generatedAt: string;
  releaseCount: number;
  recoveryTags: string[];
  releases: BundledFirmwareRelease[];
};

export type BundledFirmwareManifestLoadOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return "/";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
}

function normalizeAssetPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const relative = trimmed.replace(/^\/+/, "");
  return `${normalizeBaseUrl(import.meta.env.BASE_URL)}${relative}`;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inferFileKind(fileName: string): string | null {
  if (fileName.endsWith(".app.bin")) {
    return "app_bin";
  }
  if (fileName.endsWith(".full.bin")) {
    return "full_image";
  }
  if (fileName.endsWith(".elf")) {
    return "elf";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseAsset(value: unknown): BundledFirmwareAsset | null {
  if (!isRecord(value)) {
    return null;
  }
  const artifactId =
    typeof value.artifactId === "string" ? value.artifactId : null;
  const assetPath =
    typeof value.assetPath === "string"
      ? normalizeAssetPath(value.assetPath)
      : null;
  const fileName = typeof value.fileName === "string" ? value.fileName : null;
  const fileKind =
    typeof value.fileKind === "string"
      ? value.fileKind
      : fileName
        ? inferFileKind(fileName)
        : null;
  if (!artifactId || !assetPath || !fileName || !fileKind) {
    return null;
  }
  return {
    artifactId,
    assetPath,
    fileName,
    fileKind,
    flashAddress: toNumber(value.flashAddress, 0),
    sha256: typeof value.sha256 === "string" ? value.sha256 : undefined,
    size: typeof value.size === "number" ? value.size : undefined,
  };
}

function parseProfileAssets(
  value: unknown,
): BundledFirmwareRelease["profiles"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const profiles: NonNullable<BundledFirmwareRelease["profiles"]> = {};
  for (const [profile, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    const app = parseAsset(entry.app);
    if (!app) {
      continue;
    }
    profiles[profile] = {
      app,
      recovery: parseAsset(entry.recovery),
    };
  }
  return Object.keys(profiles).length > 0 ? profiles : undefined;
}

export function parseBundledFirmwareManifest(
  value: unknown,
): BundledFirmwareManifest {
  if (!isRecord(value)) {
    return emptyBundledFirmwareManifest();
  }

  const releases = Array.isArray(value.releases)
    ? value.releases.flatMap((entry) => {
        if (!isRecord(entry)) {
          return [];
        }
        const tagName =
          typeof entry.tagName === "string" ? entry.tagName.trim() : "";
        const version =
          typeof entry.version === "string" ? entry.version.trim() : "";
        const publishedAt =
          typeof entry.publishedAt === "string" ? entry.publishedAt : "";
        const catalogPath =
          typeof entry.catalogPath === "string"
            ? normalizeAssetPath(entry.catalogPath)
            : "";
        const app = parseAsset(entry.app);
        if (!tagName || !version || !publishedAt || !catalogPath || !app) {
          return [];
        }
        return [
          {
            tagName,
            version,
            publishedAt,
            prerelease: Boolean(entry.prerelease),
            catalogPath,
            app,
            recovery: parseAsset(entry.recovery),
            profiles: parseProfileAssets(entry.profiles),
          },
        ];
      })
    : [];

  return {
    schemaVersion:
      typeof value.schemaVersion === "string" ? value.schemaVersion : "1",
    repo: typeof value.repo === "string" ? value.repo : "",
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    releaseCount: toNumber(value.releaseCount, releases.length),
    recoveryTags: Array.isArray(value.recoveryTags)
      ? value.recoveryTags.filter(
          (tag): tag is string => typeof tag === "string" && tag.length > 0,
        )
      : [],
    releases,
  };
}

export function emptyBundledFirmwareManifest(): BundledFirmwareManifest {
  return {
    schemaVersion: "1",
    repo: "IvanLi-CN/isolappurr-usb-hub",
    generatedAt: "",
    releaseCount: 0,
    recoveryTags: [],
    releases: [],
  };
}

function cacheBustedUrl(url: string, now: () => number): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}refresh=${encodeURIComponent(String(now()))}`;
}

export async function loadBundledFirmwareManifest({
  fetchImpl = fetch,
  now = Date.now,
}: BundledFirmwareManifestLoadOptions = {}): Promise<BundledFirmwareManifest> {
  const stableUrl = normalizeAssetPath("firmware/releases-manifest.json");
  const urls = [cacheBustedUrl(stableUrl, now), stableUrl];
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Firmware manifest request failed (${res.status})`);
      }
      return parseBundledFirmwareManifest((await res.json()) as unknown);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Firmware manifest request failed.");
}

export async function fetchBundledFirmwareAssetFile(
  asset: BundledFirmwareAsset,
): Promise<File> {
  const res = await fetch(asset.assetPath, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Firmware asset request failed (${res.status})`);
  }
  const bytes = await res.arrayBuffer();
  return new File([bytes], asset.fileName, {
    type: "application/octet-stream",
  });
}

export async function fetchBundledFirmwareCatalog(
  release: BundledFirmwareRelease,
): Promise<Record<string, unknown>> {
  const res = await fetch(release.catalogPath, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Firmware catalog request failed (${res.status})`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Validate the selected artifact against the firmware-reported physical board. */
export function validateBundledArtifactCompatibility(
  catalog: Record<string, unknown>,
  artifactId: string,
  hardware:
    | {
        discoveryState?: string;
        detectedProfile?: string;
      }
    | undefined,
): void {
  if (catalog.schemaVersion !== "2") {
    throw new Error(
      "Firmware catalog schema v2 is required for hardware-safe flashing.",
    );
  }
  if (hardware?.discoveryState !== "verified" || !hardware.detectedProfile) {
    throw new Error(
      "Physical hardware discovery is not verified; flashing is blocked.",
    );
  }
  const artifacts = Array.isArray(catalog.artifacts) ? catalog.artifacts : [];
  const artifact = artifacts.find(
    (entry) => isRecord(entry) && entry.artifactId === artifactId,
  );
  if (!artifact || !isRecord(artifact)) {
    throw new Error(
      `Firmware artifact ${artifactId} is missing from the catalog.`,
    );
  }
  const compiledProfile = artifact.compiledProfile;
  const compatible = artifact.compatibleHardware;
  if (
    compiledProfile !== hardware.detectedProfile ||
    !isRecord(compatible) ||
    compatible.discoverySchema !== 1 ||
    !Array.isArray(compatible.profiles) ||
    !compatible.profiles.includes(hardware.detectedProfile)
  ) {
    throw new Error(
      `Selected firmware is incompatible with detected hardware ${hardware.detectedProfile}.`,
    );
  }
}

export const DEMO_BUNDLED_FIRMWARE_MANIFEST: BundledFirmwareManifest = {
  schemaVersion: "1",
  repo: "IvanLi-CN/isolappurr-usb-hub",
  generatedAt: "2026-07-08T00:00:00Z",
  releaseCount: 4,
  recoveryTags: ["v0.5.1", "v0.5.0-dev.2"],
  releases: [
    {
      tagName: "v0.5.1",
      version: "v0.5.1",
      publishedAt: "2026-07-06T13:09:22Z",
      prerelease: false,
      catalogPath: normalizeAssetPath(
        "firmware/releases/v0.5.1/isolapurr-firmware-catalog.json",
      ),
      app: {
        artifactId: "isolapurr-demo-051",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.5.1/isolapurr-usb-hub.app.bin",
        ),
        fileName: "isolapurr-usb-hub.app.bin",
        fileKind: "app_bin",
        flashAddress: 0x10000,
      },
      recovery: {
        artifactId: "isolapurr-demo-051-recovery",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.5.1/isolapurr-usb-hub.full.bin",
        ),
        fileName: "isolapurr-usb-hub.full.bin",
        fileKind: "full_image",
        flashAddress: 0,
      },
    },
    {
      tagName: "v0.5.0",
      version: "v0.5.0",
      publishedAt: "2026-06-29T11:05:46Z",
      prerelease: false,
      catalogPath: normalizeAssetPath(
        "firmware/releases/v0.5.0/isolapurr-firmware-catalog.json",
      ),
      app: {
        artifactId: "isolapurr-demo-050",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.5.0/isolapurr-usb-hub.app.bin",
        ),
        fileName: "isolapurr-usb-hub.app.bin",
        fileKind: "app_bin",
        flashAddress: 0x10000,
      },
      recovery: null,
    },
    {
      tagName: "v0.5.0-dev.2",
      version: "v0.5.0-dev.2",
      publishedAt: "2026-06-18T17:20:52Z",
      prerelease: true,
      catalogPath: normalizeAssetPath(
        "firmware/releases/v0.5.0-dev.2/isolapurr-firmware-catalog.json",
      ),
      app: {
        artifactId: "isolapurr-demo-050-dev2",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.5.0-dev.2/isolapurr-usb-hub.app.bin",
        ),
        fileName: "isolapurr-usb-hub.app.bin",
        fileKind: "app_bin",
        flashAddress: 0x10000,
      },
      recovery: {
        artifactId: "isolapurr-demo-050-dev2-recovery",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.5.0-dev.2/isolapurr-usb-hub.full.bin",
        ),
        fileName: "isolapurr-usb-hub.full.bin",
        fileKind: "full_image",
        flashAddress: 0,
      },
    },
    {
      tagName: "v0.4.3",
      version: "v0.4.3",
      publishedAt: "2026-06-26T17:11:54Z",
      prerelease: false,
      catalogPath: normalizeAssetPath(
        "firmware/releases/v0.4.3/isolapurr-firmware-catalog.json",
      ),
      app: {
        artifactId: "isolapurr-demo-043",
        assetPath: normalizeAssetPath(
          "firmware/releases/v0.4.3/isolapurr-usb-hub.app.bin",
        ),
        fileName: "isolapurr-usb-hub.app.bin",
        fileKind: "app_bin",
        flashAddress: 0x10000,
      },
      recovery: null,
    },
  ],
};
