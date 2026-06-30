export type BrandMarkVariant = "color" | "mono" | "light" | "dark";

export function BrandMark({
  className,
  variant = "color",
  title = "IsolaPurr USB Hub",
}: {
  className?: string;
  variant?: BrandMarkVariant;
  title?: string;
}) {
  const background =
    variant === "dark"
      ? "oklch(0.28 0.045 160)"
      : variant === "light"
        ? "oklch(0.82 0.045 160)"
        : "transparent";
  const panelFill =
    variant === "color"
      ? "url(#brand-panel-gradient)"
      : variant === "dark"
        ? "oklch(0.95 0.028 88)"
        : "oklch(0.97 0.03 88)";
  const railFill =
    variant === "dark" ? "oklch(0.2 0.02 170)" : "url(#brand-rail-gradient)";
  const shellFill =
    variant === "color" ? "url(#brand-shell-gradient)" : "oklch(0.62 0.07 160)";
  const lineFill = variant === "mono" ? panelFill : "#7dd9e9";
  const portFill = variant === "mono" ? panelFill : "#f7f1df";

  return (
    <svg
      className={className}
      viewBox="0 0 256 256"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient
          id="brand-shell-gradient"
          x1="42"
          x2="214"
          y1="42"
          y2="214"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#cfe2db" />
          <stop offset="1" stopColor="#83b7a7" />
        </linearGradient>
        <linearGradient
          id="brand-panel-gradient"
          x1="66"
          x2="190"
          y1="78"
          y2="174"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fff8e8" />
          <stop offset="1" stopColor="#e8dcc0" />
        </linearGradient>
        <linearGradient
          id="brand-rail-gradient"
          x1="80"
          x2="176"
          y1="102"
          y2="146"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#35413e" />
          <stop offset="1" stopColor="#1d2524" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill={background} />
      <rect x="42" y="42" width="172" height="172" rx="40" fill={shellFill} />
      <rect x="66" y="78" width="124" height="92" rx="30" fill={panelFill} />
      <rect x="80" y="104" width="96" height="36" rx="17" fill={railFill} />
      <rect x="98" y="117" width="60" height="9" rx="4.5" fill={portFill} />
      <rect
        x="96"
        y="154"
        width="64"
        height="5"
        rx="2.5"
        fill={lineFill}
        opacity="0.84"
      />
    </svg>
  );
}
