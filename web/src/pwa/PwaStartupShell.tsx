import { BrandMark } from "../ui/brand/BrandMark";

export type PwaStartupShellState = "launching" | "recovering" | "failed";

type PwaStartupShellProps = {
  detail?: string;
  onRepair?: () => void;
  onRetry?: () => void;
  state: PwaStartupShellState;
};

const COPY: Record<
  PwaStartupShellState,
  {
    chip: string;
    detail: string;
    message: string;
    title: string;
  }
> = {
  launching: {
    chip: "Installed console",
    title: "Starting the installed console…",
    message: "Loading your offline app shell and saved devices.",
    detail:
      "Saved devices and theme stay on this Mac even when the app shell repairs itself.",
  },
  recovering: {
    chip: "Repairing app shell",
    title: "Repairing the installed console…",
    message: "Switching this launch to the newest offline app shell.",
    detail:
      "If a newer waiting service worker is ready, this launch will reload into it automatically.",
  },
  failed: {
    chip: "Launch failed",
    title: "App launch failed",
    message: "The installed console could not finish loading this app shell.",
    detail:
      "Repair app resets service workers and cached files without touching saved devices or theme.",
  },
};

export function PwaStartupShell({
  detail,
  onRepair,
  onRetry,
  state,
}: PwaStartupShellProps) {
  const copy = COPY[state];
  const showActions = state === "failed";

  return (
    <div
      className="grid min-h-screen place-items-center overflow-hidden px-5 py-6 text-[var(--text)]"
      data-testid="pwa-startup-shell"
      data-state={state}
      style={{
        background:
          "radial-gradient(circle at top, color-mix(in srgb, var(--primary) 18%, transparent), transparent 55%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, var(--panel)), var(--bg))",
      }}
    >
      <section className="w-full max-w-[420px] rounded-[28px] border border-[color-mix(in_srgb,var(--primary)_16%,transparent)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] shadow-[0_24px_70px_rgba(31,41,55,0.16)] backdrop-blur-[24px]">
        <div className="grid gap-5 p-7 sm:p-8">
          <div className="grid justify-items-center gap-4 text-center">
            <BrandMark className="h-[106px] w-[106px]" />
            <div
              className="inline-flex min-h-8 items-center justify-center rounded-full px-3 text-[12px] font-extrabold uppercase tracking-[0.04em]"
              data-state={state}
              style={{
                backgroundColor:
                  state === "failed"
                    ? "color-mix(in srgb, var(--error) 11%, transparent)"
                    : "color-mix(in srgb, var(--primary) 10%, transparent)",
                color: state === "failed" ? "var(--error)" : "var(--primary)",
              }}
            >
              {copy.chip}
            </div>
            <div className="grid gap-2">
              <h1
                className="m-0 text-[30px] font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-[34px]"
                data-testid="pwa-startup-shell-status"
              >
                {copy.title}
              </h1>
              <p className="m-0 text-[15px] font-bold leading-6">
                {copy.message}
              </p>
              <p className="m-0 text-[13px] font-semibold leading-6 text-[var(--muted)]">
                {detail ?? copy.detail}
              </p>
            </div>
          </div>

          {showActions ? (
            <div className="grid gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  className="min-h-11 flex-1 rounded-[14px] bg-[var(--primary)] px-4 text-[13px] font-extrabold text-[var(--primary-text)] transition-transform hover:-translate-y-[1px]"
                  data-testid="pwa-startup-shell-retry"
                  type="button"
                  onClick={onRetry}
                >
                  Try again
                </button>
                <button
                  className="min-h-11 flex-1 rounded-[14px] border border-[color-mix(in_srgb,var(--error)_34%,transparent)] bg-[color-mix(in_srgb,var(--error)_9%,transparent)] px-4 text-[13px] font-extrabold text-[var(--error)] transition-transform hover:-translate-y-[1px]"
                  data-testid="pwa-startup-shell-repair"
                  type="button"
                  onClick={onRepair}
                >
                  Repair app
                </button>
              </div>
              <p className="m-0 rounded-[18px] bg-[rgba(127,148,164,0.08)] px-4 py-3 text-[13px] font-semibold leading-6 text-[var(--muted)]">
                Repair app resets service workers and cached files without
                touching saved devices or theme.
              </p>
            </div>
          ) : (
            <div
              className="h-2 overflow-hidden rounded-full bg-[rgba(127,148,164,0.12)]"
              aria-hidden="true"
            >
              <span
                className="block h-full w-[42%] rounded-full bg-[linear-gradient(90deg,var(--primary),var(--secondary))]"
                style={{
                  animation:
                    "isolapurr-boot-progress 1.15s ease-in-out infinite",
                }}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
