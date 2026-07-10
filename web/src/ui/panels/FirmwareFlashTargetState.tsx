import type { ReactNode } from "react";

function SpinnerIcon({
  className = "h-4 w-4 animate-spin text-[var(--primary)]",
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
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

function ProbeLoadingRail() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-[94px] w-[72px] shrink-0 flex-col items-center justify-center border-r border-[var(--border)] pr-3"
    >
      <div className="relative grid h-9 w-9 place-items-center">
        <span className="absolute inset-0 rounded-full border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] motion-safe:animate-ping motion-reduce:animate-none" />
        <span className="absolute inset-1 rounded-full border border-[color-mix(in_srgb,var(--primary)_28%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_6%,var(--panel))]" />
        <SpinnerIcon className="relative h-[18px] w-[18px] animate-spin text-[var(--primary)]" />
      </div>
      <span className="mt-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
        Reading
      </span>
      <span className="mt-1.5 flex items-center gap-1">
        <span className="h-1 w-1 rounded-full bg-[var(--primary)] motion-safe:animate-pulse motion-reduce:animate-none" />
        <span className="h-1 w-1 rounded-full bg-[var(--primary)] opacity-60 [animation-delay:160ms] motion-safe:animate-pulse motion-reduce:animate-none" />
        <span className="h-1 w-1 rounded-full bg-[var(--primary)] opacity-30 [animation-delay:320ms] motion-safe:animate-pulse motion-reduce:animate-none" />
      </span>
    </div>
  );
}

export function FirmwareFlashTargetState({
  title,
  detail,
  countdownSeconds,
  busy = false,
  action,
  countdownEmphasis = "inline",
}: {
  title: string;
  detail: string;
  countdownSeconds?: number | null;
  busy?: boolean;
  action?: ReactNode;
  countdownEmphasis?: "inline" | "aside";
}) {
  const countdownLabel =
    typeof countdownSeconds === "number"
      ? countdownSeconds > 0
        ? `${countdownSeconds}s`
        : "Taking longer…"
      : null;
  const showAsideCountdown =
    countdownEmphasis === "aside" && countdownLabel !== null;
  const showLoadingRail = busy;
  const countdownSecondsValue =
    typeof countdownSeconds === "number"
      ? String(Math.max(0, countdownSeconds))
      : null;
  const countdownMetaLabel =
    typeof countdownSeconds === "number" && countdownSeconds > 0
      ? "Probe window"
      : "Probe timeout";
  const rightContent = showAsideCountdown ? (
    <div
      className="flex min-h-[94px] flex-col justify-between rounded-[12px] border border-[color-mix(in_srgb,var(--primary)_14%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_5%,var(--panel))] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)]"
      data-testid="firmware-flash-probe-countdown"
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        {countdownMetaLabel}
      </div>
      <div className="mt-1.5 flex items-end gap-1.5">
        <span className="font-mono text-[48px] font-bold leading-none tracking-[-0.09em] text-[var(--text)] [font-variant-numeric:tabular-nums]">
          {countdownSecondsValue}
        </span>
        <span className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
          sec
        </span>
      </div>
      <div className="mt-1 text-[10px] font-semibold leading-4 text-[var(--muted)]">
        {typeof countdownSeconds === "number" && countdownSeconds > 0
          ? "Board probe in progress."
          : "Probe is taking longer than expected."}
      </div>
    </div>
  ) : action ? (
    action
  ) : null;

  return (
    <div
      className="mt-3 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3.5 py-2.5 sm:px-4 sm:py-3"
      data-testid="firmware-flash-target-state"
    >
      <div
        className={[
          "grid gap-3",
          rightContent
            ? "lg:grid-cols-[minmax(0,1fr)_192px] lg:items-stretch"
            : "",
        ].join(" ")}
      >
        <div
          className={
            showLoadingRail
              ? "grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-3"
              : "min-w-0"
          }
        >
          {showLoadingRail ? <ProbeLoadingRail /> : null}
          <div className="min-w-0 self-center">
            <div className="flex flex-wrap items-center gap-2">
              {!showLoadingRail && busy ? <SpinnerIcon /> : null}
              <div className="text-[14px] font-bold text-[var(--text)]">
                {title}
              </div>
              {countdownLabel && !showAsideCountdown ? (
                <span className="inline-flex h-7 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] font-bold text-[var(--muted)]">
                  {countdownLabel}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 max-w-[48ch] text-[13px] font-semibold leading-5 text-[var(--muted)]">
              {detail}
            </div>
            {showLoadingRail ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5 text-[var(--text)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] motion-safe:animate-pulse motion-reduce:animate-none" />
                  Serial link
                </span>
                <span className="h-px w-4 bg-[var(--border)]" />
                <span>Firmware identity</span>
              </div>
            ) : null}
          </div>
        </div>
        {rightContent ? (
          <div className="lg:w-[192px] lg:justify-self-end">{rightContent}</div>
        ) : null}
      </div>
    </div>
  );
}
