import { BrandMark, type BrandMarkVariant } from "./BrandMark";

export type BrandLogoSize = "sm" | "md";

export function BrandLogo({
  className,
  markVariant = "color",
  size = "md",
  title = "IsolaPurr USB Hub",
}: {
  className?: string;
  markVariant?: BrandMarkVariant;
  size?: BrandLogoSize;
  title?: string;
}) {
  const markClassName = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const textClassName =
    size === "sm"
      ? "text-[16px] font-[800] tracking-[-0.025em]"
      : "text-[17px] font-[800] tracking-[-0.03em]";

  return (
    <span
      aria-label={title}
      role="img"
      className={[
        "inline-flex items-center gap-2.5 leading-none text-current",
        className ?? "",
      ].join(" ")}
    >
      <BrandMark
        className={`${markClassName} shrink-0`}
        variant={markVariant}
      />
      <span className={textClassName}>IsolaPurr USB Hub</span>
    </span>
  );
}
