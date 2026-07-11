import { useEffect, useRef, useState } from "react";

import type { ThemeId } from "../../app/theme";
import { ActionButton } from "../actions/ActionButton";

const OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: "isolapurr", label: "isolapurr" },
  { id: "isolapurr-dark", label: "isolapurr-dark" },
  { id: "system", label: "system" },
];

export function ThemeMenu({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (next: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;

  const buttonLabel =
    value === "system" ? (prefersDark ? "isolapurr-dark" : "isolapurr") : value;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current) {
        return;
      }
      if (ref.current.contains(e.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <div className="text-[12px] font-semibold text-[var(--muted)]">Theme</div>
      <ActionButton
        align="between"
        className="w-[150px] px-3"
        size="sm"
        tone="secondary"
        onClick={() => setOpen((v) => !v)}
      >
        {buttonLabel} ▾
      </ActionButton>
      {open ? (
        <div
          className={[
            "iso-popover absolute right-0 top-full z-50 mt-2",
            "w-[200px] rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-2",
          ].join(" ")}
          role="menu"
        >
          {OPTIONS.map((opt) => (
            <ActionButton
              align="between"
              fullWidth
              key={opt.id}
              role="menuitemradio"
              aria-checked={opt.id === value}
              size="sm"
              tone={opt.id === value ? "secondary" : "quiet"}
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {opt.id === value ? (
                <span className="text-[var(--muted)]">✓</span>
              ) : null}
            </ActionButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}
