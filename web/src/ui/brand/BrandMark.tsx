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
  const isMono = variant === "mono";
  const background =
    variant === "dark"
      ? "oklch(0.22 0.035 264)"
      : variant === "light"
        ? "oklch(0.98 0.008 240)"
        : "oklch(0.97 0.009 240)";
  const shadow = isMono ? "none" : "0 4px 12px oklch(0.35 0.04 264 / 0.18)";
  const padFill = isMono ? "var(--text)" : "url(#brand-pad-gradient)";
  const surfaceFill = isMono ? "var(--panel)" : "oklch(0.985 0.006 240)";
  const trace = isMono ? "var(--text)" : "url(#brand-trace-gradient)";

  return (
    <svg
      className={className}
      viewBox="0 0 256 256"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient
          id="brand-pad-gradient"
          x1="64"
          x2="192"
          y1="32"
          y2="224"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="oklch(0.78 0.105 190)" />
          <stop offset="0.56" stopColor="oklch(0.56 0.13 276)" />
          <stop offset="1" stopColor="oklch(0.38 0.075 270)" />
        </linearGradient>
        <linearGradient
          id="brand-trace-gradient"
          x1="52"
          x2="212"
          y1="46"
          y2="196"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="oklch(0.94 0.05 184)" />
          <stop offset="1" stopColor="oklch(0.88 0.06 275)" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={background} />
      <path
        fill="oklch(0.15 0.028 264)"
        d="M128 32c47.5 0 86 38.5 86 86 0 27.3-12.8 51.7-32.7 67.4l5.5 24.3c1.7 7.7-5.9 14.1-13.2 11l-22.7-9.5a86 86 0 1 1-22.9-179.2Z"
        opacity={isMono ? 0 : 0.08}
      />
      <path
        fill={padFill}
        style={{ filter: `drop-shadow(${shadow})` }}
        d="M128 38c43.6 0 79 35.4 79 79 0 25.6-12.2 48.4-31.1 62.9l5.7 25.4c.9 4.1-3.2 7.5-7.1 5.9l-24.3-10.2A79 79 0 1 1 128 38Z"
      />
      <g fill={surfaceFill}>
        <circle cx="84" cy="91" r="21" />
        <circle cx="116" cy="70" r="20" />
        <circle cx="151" cy="70" r="20" />
        <circle cx="181" cy="94" r="21" />
        <path d="M84 148c0-27.6 18.4-49 44-49s44 21.4 44 49c0 21.6-13.7 33-30.4 26.4-8.9-3.5-18.3-3.5-27.2 0C97.7 181 84 169.6 84 148Z" />
      </g>
      <g
        fill="none"
        stroke={trace}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="8"
      >
        <path d="M128 99v45" />
        <path d="M105 143H74" />
        <path d="M151 143h31" />
        <path d="M116 119 91 94" />
        <path d="M140 119 166 93" />
      </g>
      <g fill="oklch(0.15 0.028 264)">
        <circle cx="74" cy="143" r="6" />
        <circle cx="182" cy="143" r="6" />
        <circle cx="128" cy="144" r="7" />
      </g>
    </svg>
  );
}
