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
      ? "oklch(0.28 0.045 160)"
      : variant === "light"
        ? "oklch(0.82 0.045 160)"
        : "oklch(0.82 0.05 170)";
  const markFill =
    variant === "color"
      ? "url(#brand-mark-gradient)"
      : variant === "dark"
        ? "oklch(0.95 0.028 88)"
        : "oklch(0.97 0.03 88)";
  const shadow = isMono ? "none" : "0 5px 14px oklch(0.35 0.045 160 / 0.16)";
  const bodyFill =
    variant === "color" ? "url(#brand-body-gradient)" : background;

  return (
    <svg
      className={className}
      viewBox="0 0 256 256"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient
          id="brand-body-gradient"
          x1="34"
          x2="220"
          y1="22"
          y2="232"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#bcded5" />
          <stop offset="1" stopColor="#a8cbbf" />
        </linearGradient>
        <linearGradient
          id="brand-mark-gradient"
          x1="82"
          x2="178"
          y1="28"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#f9efd8" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" fill="oklch(0.97 0.008 120)" />
      <rect width="256" height="256" rx="54" fill={bodyFill} />
      <g transform="matrix(1.07 0 0 1.07 -18.59 0.5)">
        <path
          fill={markFill}
          style={{ filter: `drop-shadow(${shadow})` }}
          d="M80 31H194C206 31 216 41 216 53C216 64 208 73 197 75L176 78C163 80 154 91 154 104V125C154 138 163 149 176 151L197 154C208 156 216 165 216 176C216 188 206 198 194 198H80C68 198 58 188 58 176C58 165 66 156 77 154L98 151C111 149 119 138 119 125V104C119 91 111 80 98 78L77 75C66 73 58 64 58 53C58 41 68 31 80 31Z"
        />
      </g>
    </svg>
  );
}
