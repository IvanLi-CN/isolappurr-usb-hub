import type { BundledFirmwareRelease } from "../../domain/firmwareBundle";

function formatPublishedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function FirmwareReleaseList({
  releases,
  selectedTag,
  recoveryOnly,
  disabled = false,
  onSelect,
}: {
  releases: BundledFirmwareRelease[];
  selectedTag: string | null;
  recoveryOnly: boolean;
  disabled?: boolean;
  onSelect: (tagName: string) => void;
}) {
  if (releases.length === 0) {
    return (
      <div className="rounded-[16px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-5 text-[13px] font-semibold text-[var(--muted)]">
        No bundled firmware releases are available in this build.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {releases.map((release) => {
        const selected = release.tagName === selectedTag;
        const recoveryAvailable = Boolean(release.recovery);
        const releaseDisabled =
          disabled || (recoveryOnly && !recoveryAvailable);
        const sourceDescription = recoveryOnly
          ? "Recovery image bundled for first-time provisioning and damaged-firmware recovery."
          : recoveryAvailable
            ? "App upgrade image bundled. Recovery image is also available for provisioning and repair."
            : "App upgrade image bundled into this Web build.";
        return (
          <button
            key={release.tagName}
            className={[
              "w-full rounded-[16px] border px-4 py-4 text-left transition-colors",
              selected
                ? "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[var(--panel)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_16%,transparent)]"
                : "border-[var(--border)] bg-[var(--panel)]",
              releaseDisabled
                ? "cursor-not-allowed opacity-55"
                : "hover:bg-[var(--panel-2)]",
            ].join(" ")}
            type="button"
            disabled={releaseDisabled}
            onClick={() => onSelect(release.tagName)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-[16px] font-bold leading-5 text-[var(--text)]">
                    {release.version}
                  </div>
                  <div className="font-mono text-[12px] font-semibold text-[var(--muted)]">
                    {release.tagName}
                  </div>
                  {release.prerelease ? (
                    <span className="rounded-full bg-[var(--badge-warning-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--badge-warning-text)]">
                      prerelease
                    </span>
                  ) : null}
                  {recoveryAvailable ? (
                    <span className="rounded-full bg-[var(--badge-success-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--badge-success-text)]">
                      recovery
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 font-mono text-[12px] font-semibold text-[var(--text)]">
                  {release.tagName}
                </div>
                <div className="mt-2 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  {sourceDescription}
                </div>
              </div>
              <div className="shrink-0 text-[12px] font-bold text-[var(--muted)]">
                {formatPublishedAt(release.publishedAt)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
