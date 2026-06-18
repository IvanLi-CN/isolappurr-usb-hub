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
  pathTestId,
}: {
  code: string;
  title: string;
  description: string;
  context?: ReactNode;
  actions: ErrorStateAction[];
  fullPage?: boolean;
  eyebrow?: ReactNode;
  testId?: string;
  pathTestId?: string;
}) {
  const shell = (
    <section
      className={[
        "relative overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--panel)] text-[var(--text)]",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]",
        fullPage
          ? "w-full px-6 py-8 sm:px-8 sm:py-10"
          : "px-6 py-7 sm:px-8 sm:py-8",
      ].join(" ")}
      data-testid={fullPage ? "error-state-full-page" : "error-state-inline"}
    >
      <div
        aria-hidden="true"
        className="absolute right-0 top-0 h-28 w-28 rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] blur-2xl"
      />
      <div className="relative flex flex-col gap-6 sm:gap-7">
        <div className="max-w-[620px]">
          {eyebrow ? (
            <div className="mb-4 inline-flex rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[16px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--primary)_8%,var(--panel))] font-mono text-[24px] font-bold tracking-[-0.03em] text-[var(--primary)]">
              {code}
            </div>
            <div className="min-w-0">
              <h1 className="text-balance text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
                {title}
              </h1>
              <p className="mt-3 max-w-[54ch] text-[14px] font-medium leading-6 text-[var(--muted)] sm:text-[15px]">
                {description}
              </p>
              {context ? (
                <div
                  className="mt-4 max-w-full rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] font-medium leading-5 text-[var(--muted)]"
                  data-testid={pathTestId}
                >
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
                "inline-flex h-11 w-full items-center justify-center rounded-[10px] border px-4 text-[13px] font-bold transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] sm:w-auto",
                action.variant === "primary"
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-text)] hover:bg-[var(--primary-2)]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)] hover:border-[var(--primary)]/35 hover:bg-[color-mix(in_srgb,var(--primary)_8%,var(--panel-2))]",
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
      <main
        className="mx-auto flex min-h-screen w-full max-w-none items-center justify-center bg-[var(--bg)] px-6 py-10"
        data-testid={testId}
      >
        <div className="w-full max-w-[980px]">{shell}</div>
      </main>
    );
  }

  return <div data-testid={testId}>{shell}</div>;
}
