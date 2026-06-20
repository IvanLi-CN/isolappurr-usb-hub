import type { Meta, StoryObj } from "@storybook/react";

type TokenSpec = {
  label: string;
  token: string;
  note: string;
};

const coreTokens: TokenSpec[] = [
  {
    label: "Primary",
    token: "--primary",
    note: "Main CTA, current selection, install entry",
  },
  {
    label: "Primary 2",
    token: "--primary-2",
    note: "Primary hover and lighter supporting surfaces",
  },
  {
    label: "Secondary",
    token: "--secondary",
    note: "Brand warm-amber emphasis for live protocol focus",
  },
  {
    label: "Focus",
    token: "--focus",
    note: "Keyboard focus and high-contrast outlines",
  },
];

const surfaceTokens: TokenSpec[] = [
  { label: "Background", token: "--bg", note: "App background" },
  { label: "Panel", token: "--panel", note: "Primary card surface" },
  { label: "Panel 2", token: "--panel-2", note: "Nested surface layer" },
  { label: "Border", token: "--border", note: "Hairline separators" },
];

const semanticTokens: TokenSpec[] = [
  { label: "Success", token: "--success", note: "Positive state only" },
  { label: "Warning", token: "--warning", note: "Caution and degraded states" },
  { label: "Error", token: "--error", note: "Failures and destructive states" },
];

function TokenSwatch({ label, token, note }: TokenSpec) {
  return (
    <div className="grid gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-3">
      <div
        className="h-14 rounded-[10px] border border-black/5"
        style={{ backgroundColor: `var(${token})` }}
      />
      <div className="space-y-0.5">
        <div className="text-[13px] font-semibold text-[var(--text)]">
          {label}
        </div>
        <div className="text-[11px] text-[var(--muted)]">{note}</div>
        <code className="text-[10px] text-[var(--muted)]">{token}</code>
      </div>
    </div>
  );
}

function ThemeReviewPanel({
  theme,
  title,
}: {
  theme: "isolapurr" | "isolapurr-dark";
  title: string;
}) {
  return (
    <section
      className="grid gap-5 rounded-[24px] border border-[var(--border)] bg-[var(--bg)] p-5 text-[var(--text)]"
      data-theme={theme}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="m-0 text-[20px] font-semibold">{title}</h2>
          <p className="m-0 max-w-[64ch] text-[13px] text-[var(--muted)]">
            Primary stays on task actions and stable selection. Secondary is a
            restrained warm-amber family derived from the brand mark, reserved
            for live protocol emphasis rather than success semantics.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
          {theme}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-5">
          <div className="grid gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
              Core Tokens
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {coreTokens.map((token) => (
                <TokenSwatch key={token.token} {...token} />
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
              Surface Tokens
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {surfaceTokens.map((token) => (
                <TokenSwatch key={token.token} {...token} />
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
              Semantic Tokens
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {semanticTokens.map((token) => (
                <TokenSwatch key={token.token} {...token} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
            Consumption Review
          </div>

          <div className="grid gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-[var(--primary)] px-3 py-1 text-[11px] font-semibold text-[var(--primary-text)]">
                Primary action
              </span>
              <span className="inline-flex rounded-full bg-[var(--secondary)] px-3 py-1 text-[11px] font-semibold text-[var(--secondary-text)]">
                Secondary emphasis
              </span>
              <span className="inline-flex rounded-full bg-[var(--badge-success-bg)] px-3 py-1 text-[11px] font-semibold text-[var(--badge-success-text)]">
                Success state
              </span>
            </div>

            <div className="rounded-[14px] border-[1.5px] border-[var(--protocol-active-ring)] bg-[linear-gradient(180deg,var(--protocol-active-top),var(--protocol-active-bg))] p-3 shadow-[inset_0_1px_0_var(--protocol-active-inner-highlight),0_0_0_1px_var(--protocol-active-outline),0_12px_20px_-16px_var(--protocol-active-shadow)]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold">PD</span>
                  <span className="inline-flex h-4.5 items-center rounded-full border border-current/15 bg-[var(--panel)] px-1.5 text-[9px] font-bold uppercase tracking-[0.02em]">
                    CC
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full border border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.04em] text-[var(--protocol-live-text)]">
                    Live
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <span className="inline-flex h-4.5 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-1 text-[8px] font-semibold text-[var(--text)]">
                  4 PDO
                </span>
                <span className="inline-flex h-4.5 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-1 text-[8px] font-semibold text-[var(--text)]">
                  5A Off
                </span>
              </div>
            </div>

            <p className="m-0 text-[12px] leading-5 text-[var(--muted)]">
              The active card uses <code>--secondary</code> as an informational
              highlight. Active protocol state collapses into a single Live
              badge so the header keeps one clear emphasis target.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const meta = {
  title: "Brand/ThemePalette",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const Review: Story = {
  render: () => (
    <div className="grid gap-6 bg-[#eef2f4] p-6">
      <ThemeReviewPanel theme="isolapurr" title="Light theme review" />
      <ThemeReviewPanel theme="isolapurr-dark" title="Dark theme review" />
    </div>
  ),
};
