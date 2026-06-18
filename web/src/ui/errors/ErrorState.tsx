import type { ReactNode } from "react";
import { DemoLink } from "../../app/demo-navigation";

type ErrorStateAction = {
  label: string;
  to: string;
  variant?: "primary" | "secondary";
};

export function ErrorState({
  code,
  title,
  description,
  context,
  actions,
  fullPage = false,
  eyebrow,
  testId,
}: {
  code: string;
  title: string;
  description: string;
  context?: ReactNode;
  actions: ErrorStateAction[];
  fullPage?: boolean;
  eyebrow?: ReactNode;
  testId?: string;
}) {
  const shell = (
    <section
      className={[
        "relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--panel)] text-[var(--text)]",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]",
        fullPage ? "w-full" : "px-6 py-7 sm:px-8 sm:py-8",
      ].join(" ")}
      data-testid={fullPage ? "error-state-full-page" : "error-state-inline"}
    >
      <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-[color-mix(in_srgb,var(--primary)_18%,transparent)] blur-3xl" />
      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[620px]">
          {eyebrow ? (
            <div className="mb-4 inline-flex rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[24px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--primary)_10%,var(--panel))] font-mono text-[28px] font-bold tracking-[-0.03em] text-[var(--primary)]">
              {code}
            </div>
            <div className="min-w-0">
              <h1 className="text-balance text-[30px] font-bold tracking-[-0.03em] sm:text-[38px]">
                {title}
              </h1>
              <p className="mt-3 max-w-[58ch] text-[14px] font-medium leading-6 text-[var(--muted)] sm:text-[15px]">
                {description}
              </p>
              {context ? (
                <div className="mt-4 flex max-w-full flex-wrap items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] font-medium text-[var(--muted)]">
                  {context}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {actions.map((action) => (
            <DemoLink
              key={`${action.to}-${action.label}`}
              className={[
                "inline-flex h-11 items-center justify-center rounded-[14px] border px-4 text-[13px] font-bold transition-colors",
                action.variant === "primary"
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-text)]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]",
              ].join(" ")}
              to={action.to}
            >
              {action.label}
            </DemoLink>
          ))}
        </div>
      </div>
    </section>
  );

  if (fullPage) {
    return (
      <div
        className="mx-auto flex min-h-screen w-full max-w-none items-center justify-center bg-[var(--bg)] px-6 py-10"
        data-testid={testId}
      >
        <div className="w-full max-w-[980px]">{shell}</div>
      </div>
    );
  }

  return <div data-testid={testId}>{shell}</div>;
}
