function ProgressSpinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 animate-spin text-[var(--primary)]"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle
        cx="8"
        cy="8"
        r="5.25"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="1.5"
      />
      <path
        d="M13.25 8A5.25 5.25 0 0 0 8 2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export type FirmwareFlashLogEntry = {
  id: string;
  timestampLabel: string;
  level: "info" | "success" | "error";
  message: string;
};

export function FirmwareFlashLogPanel({
  title,
  detail,
  status = "idle",
  progressPercent,
  indeterminate = false,
  entries,
  emptyText,
}: {
  title: string;
  detail: string;
  status?: "idle" | "working" | "success" | "error";
  progressPercent?: number | null;
  indeterminate?: boolean;
  entries: FirmwareFlashLogEntry[];
  emptyText: string;
}) {
  const safeProgress =
    typeof progressPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null;
  const progressToneClass =
    status === "error"
      ? "bg-[var(--error)]"
      : status === "success"
        ? "bg-[var(--surface-success-ring)]"
        : "bg-[var(--primary)]";

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="text-[14px] font-bold">Flash log</div>
      <div className="mt-2 flex items-start gap-2">
        {status === "working" ? <ProgressSpinner /> : null}
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-[var(--text)]">
            {title}
          </div>
          <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
            {detail}
          </div>
        </div>
        {safeProgress !== null ? (
          <div className="shrink-0 text-[11px] font-bold text-[var(--muted)]">
            {safeProgress}%
          </div>
        ) : null}
      </div>

      {status !== "idle" || safeProgress !== null ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
          <div
            className={[
              "h-full rounded-full transition-[width] duration-500",
              indeterminate ? "w-[42%] animate-pulse" : "",
              progressToneClass,
            ].join(" ")}
            style={
              indeterminate ? undefined : { width: `${safeProgress ?? 0}%` }
            }
          />
        </div>
      ) : null}

      <div className="mt-3 max-h-[220px] overflow-auto rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)]">
        {entries.length > 0 ? (
          <div className="divide-y divide-[var(--border)]">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 px-3 py-2.5"
              >
                <div className="font-mono text-[11px] font-semibold text-[var(--muted)]">
                  {entry.timestampLabel}
                </div>
                <div
                  className={[
                    "font-mono text-[11px] leading-5",
                    entry.level === "error"
                      ? "text-[var(--error)]"
                      : entry.level === "success"
                        ? "text-[var(--text)]"
                        : "text-[var(--muted)]",
                  ].join(" ")}
                >
                  {entry.message}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-[12px] font-semibold leading-6 text-[var(--muted)]">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
