import type { ReactNode } from "react";

export const primaryButtonClass =
  "flex items-center justify-center rounded-[10px] bg-[var(--primary)] px-4 text-[12px] font-bold text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-2)] disabled:bg-[var(--btn-disabled-fill)] disabled:text-[var(--btn-disabled-text)]";

export const outlineButtonClass =
  "flex items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-4 text-[12px] font-bold text-[var(--text)] transition-colors hover:bg-[var(--panel-2)] disabled:border-[var(--border)] disabled:bg-[var(--btn-disabled-fill-soft)] disabled:text-[var(--btn-disabled-text)]";

export function SpinnerIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${className} animate-spin`}
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

export function ReconnectIcon({
  className = "h-4 w-4",
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
      <path
        d="M13 5.5V2.75m0 0H10.25m2.75 0L10.9 4.85A4.75 4.75 0 1 0 12.75 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function RemoveIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M6.2 5.05 5.15 6.1a2.25 2.25 0 0 0 0 3.18 2.25 2.25 0 0 0 3.18 0l1.05-1.05m.42-2.28 1.05-1.05a2.25 2.25 0 0 1 3.18 0 2.25 2.25 0 0 1 0 3.18l-1.05 1.05M4.25 11.75l7.5-7.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function TransportChoiceCard({
  title,
  status,
  description,
  selectionSummary,
  selectionDetail,
  selectionActions,
  busy = false,
  disabled = false,
  onMouseDownActivate,
  onClick,
}: {
  title: string;
  status: string;
  description: string;
  selectionSummary?: string;
  selectionDetail?: string;
  selectionActions?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onMouseDownActivate?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={[
        "relative flex h-full w-full min-w-0 flex-col rounded-[14px] border border-[var(--border)] bg-[var(--panel)] px-4 py-3.5 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-70"
          : "cursor-pointer hover:bg-[var(--panel-2)]",
      ].join(" ")}
    >
      <button
        aria-label={`Choose ${title}`}
        className="absolute inset-0 z-0 rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/20"
        disabled={disabled}
        type="button"
        onMouseDown={
          onMouseDownActivate && !disabled
            ? (event) => {
                if (event.button !== 0) {
                  return;
                }
                event.preventDefault();
                onMouseDownActivate();
              }
            : undefined
        }
        onClick={
          onMouseDownActivate && !disabled
            ? (event) => {
                if (event.detail !== 0) {
                  event.preventDefault();
                  return;
                }
                onClick();
              }
            : disabled
              ? undefined
              : onClick
        }
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[14px] font-bold text-[var(--text)]">
            {title}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            {busy ? (
              <span
                aria-hidden="true"
                className="h-3 w-3 animate-spin rounded-full border border-current border-r-transparent"
              />
            ) : null}
            {status}
          </div>
        </div>
        <div className="mt-2.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
          {description}
        </div>
        {selectionSummary ? (
          <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
            <div
              className={[
                "flex min-w-0 gap-3",
                selectionActions ? "items-center" : "",
              ].join(" ")}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-[var(--text)]">
                  {selectionSummary}
                </div>
                {selectionDetail ? (
                  <div className="mt-1 text-[11px] font-semibold leading-5 text-[var(--muted)]">
                    {selectionDetail}
                  </div>
                ) : null}
              </div>
              {selectionActions ? (
                <div className="pointer-events-auto flex shrink-0 items-center gap-2">
                  {selectionActions}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function FlashSummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <div className="font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </div>
      <div
        className={[
          "min-w-0 truncate font-bold text-[var(--text)]",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </div>
    </>
  );
}

export function TargetInfoCell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </dt>
      <dd
        className={[
          "mt-1 min-w-0 break-words text-[12px] font-bold leading-6 text-[var(--text)]",
          mono ? "font-mono text-[11px] sm:text-[12px]" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}
