import { useEffect, useRef, useState } from "react";

import {
  type BundledFirmwareManifest,
  DEMO_BUNDLED_FIRMWARE_MANIFEST,
  emptyBundledFirmwareManifest,
  loadBundledFirmwareManifest,
} from "../domain/firmwareBundle";
import { PWA_UPDATE_AVAILABLE_EVENT } from "../pwa/events";

const FIRMWARE_MANIFEST_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export function useBundledFirmwareManifest(demoEnabled: boolean) {
  const [manifest, setManifest] = useState<BundledFirmwareManifest>(
    demoEnabled
      ? DEMO_BUNDLED_FIRMWARE_MANIFEST
      : emptyBundledFirmwareManifest(),
  );
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState<string | null>(
    null,
  );
  const manifestRefreshSerialRef = useRef(0);

  useEffect(() => {
    if (demoEnabled) {
      setManifest(DEMO_BUNDLED_FIRMWARE_MANIFEST);
      setSelectedReleaseTag(
        DEMO_BUNDLED_FIRMWARE_MANIFEST.releases[0]?.tagName ?? null,
      );
      return;
    }
    let cancelled = false;

    const refreshManifest = async () => {
      const refreshSerial = ++manifestRefreshSerialRef.current;
      try {
        const next = await loadBundledFirmwareManifest();
        if (cancelled || refreshSerial !== manifestRefreshSerialRef.current) {
          return;
        }
        setManifest(next);
        setManifestError(null);
        setSelectedReleaseTag((current) =>
          current &&
          next.releases.some((release) => release.tagName === current)
            ? current
            : (next.releases[0]?.tagName ?? null),
        );
      } catch (err) {
        if (cancelled || refreshSerial !== manifestRefreshSerialRef.current) {
          return;
        }
        setManifestError(
          err instanceof Error
            ? err.message
            : "Bundled firmware manifest failed to load.",
        );
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshManifest();
    };

    const intervalId = window.setInterval(
      refreshWhenVisible,
      FIRMWARE_MANIFEST_REFRESH_INTERVAL_MS,
    );
    void refreshManifest();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    window.addEventListener(PWA_UPDATE_AVAILABLE_EVENT, refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      window.removeEventListener(
        PWA_UPDATE_AVAILABLE_EVENT,
        refreshWhenVisible,
      );
    };
  }, [demoEnabled]);

  return {
    manifest,
    manifestError,
    selectedReleaseTag,
    setSelectedReleaseTag,
  };
}
