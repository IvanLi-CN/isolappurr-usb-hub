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
    title: "Starting console…",
    message: "Loading your offline app shell.",
    detail: "",
  },
  recovering: {
    chip: "Repairing app shell",
    title: "Repairing console…",
    message: "Switching to the newest offline app shell.",
    detail: "",
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
  const supportingDetail = detail ?? copy.detail;

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
      <section className="w-full max-w-[440px] rounded-[28px] border border-[color-mix(in_srgb,var(--primary)_16%,transparent)] bg-[color-mix(in_srgb,var(--panel)_94%,transparent)] shadow-[0_24px_70px_rgba(31,41,55,0.16)] backdrop-blur-[24px] sm:max-w-[500px]">
        <div className="grid gap-6 p-8 sm:gap-7 sm:px-10 sm:py-9">
          <div className="grid justify-items-center gap-5 text-center">
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
            <div className="mx-auto grid max-w-[33ch] gap-3">
              <h1
                className="m-0 mx-auto w-fit whitespace-nowrap text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[32px]"
                data-testid="pwa-startup-shell-status"
              >
                {copy.title}
              </h1>
              <p className="m-0 text-[14px] font-medium leading-6 sm:text-[15px]">
                {copy.message}
              </p>
              {supportingDetail ? (
                <p className="m-0 text-[13px] font-medium leading-[1.7] text-[var(--muted)]">
                  {supportingDetail}
                </p>
              ) : null}
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
              className="h-2 overflow-hidden rounded-full"
              aria-hidden="true"
              style={{ backgroundColor: "var(--loading-track)" }}
            >
              <span
                className="block h-full w-[42%] rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, var(--loading-accent) 0%, var(--loading-accent-2) 100%)",
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
