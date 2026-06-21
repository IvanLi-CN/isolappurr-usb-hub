import {
  Children,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type {
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigResponse,
} from "../../domain/deviceApi";

export type FormState = PowerConfigInput;
type NegotiationChannel = "cc" | "dpdm";
export type ActiveProtocol = NonNullable<
  PdDiagnosticsResponse["active_protocol"]
>;

export function cloneConfig(config: PowerConfigResponse): FormState {
  return {
    hardware: "sw2303",
    tps_mode: config.tps_mode,
    light_load_mode: config.light_load_mode,
    capability: config.capability,
    manual: {
      voltage_mv: config.manual.voltage_mv,
      current_limit_ma: config.manual.current_limit_ma,
      usb_c_path_mode: config.manual.usb_c_path_mode,
    },
  };
}

export function badgeTone(enabled: boolean): string {
  return enabled
    ? "border border-[var(--surface-success-ring)] bg-[var(--surface-success-bg)] text-[var(--badge-success-text)]"
    : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]";
}

export function negotiationBadgeLabel(channel: NegotiationChannel): string {
  return channel === "cc" ? "CC" : "DPDM";
}

export function formatVoltageOption(mv: number): string {
  return `${mv / 1000}V`;
}

export function boolLabel(enabled: boolean): string {
  return enabled ? "On" : "Off";
}

export function formatCompactCurrent(ma: number): string {
  const amps = ma / 1000;
  return `${Number.isInteger(amps) ? amps : Number(amps.toFixed(2))}A`;
}

export function formatFixedVoltageSummary(voltagesMv: number[]): string {
  if (voltagesMv.length === 0) {
    return "PDO Off";
  }
  if (voltagesMv.length === 1) {
    return `${voltagesMv[0] / 1000}V`;
  }
  return `${voltagesMv.length} PDO`;
}

export function activeProtocolLabel(
  protocol: ActiveProtocol | null,
): string | null {
  return protocol ? "Live" : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function normalizeUnit(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replaceAll("μ", "u")
    .replaceAll("µ", "u")
    .replaceAll("mu", "u");
}

function parseUnitNumber(raw: string): { value: number; unit: string } | null {
  const match = normalizeUnit(raw).match(/^([+-]?\d+(?:\.\d*)?)\s*([a-z.]*)$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { value, unit: match[2] };
}

export function parseVoltageInput(raw: string): number | null {
  const parsed = parseUnitNumber(raw);
  if (!parsed) {
    return null;
  }
  if (parsed.unit === "" || parsed.unit === "v") {
    return parsed.value * 1000;
  }
  if (parsed.unit === "mv") {
    return parsed.value;
  }
  return null;
}

export function parseCurrentInput(raw: string): number | null {
  const parsed = parseUnitNumber(raw);
  if (!parsed) {
    return null;
  }
  if (parsed.unit === "" || parsed.unit === "ma") {
    return parsed.value;
  }
  if (parsed.unit === "a") {
    return parsed.value * 1000;
  }
  return null;
}

export function parsePowerInput(raw: string): number | null {
  const parsed = parseUnitNumber(raw);
  if (!parsed || (parsed.unit !== "" && parsed.unit !== "w")) {
    return null;
  }
  return parsed.value;
}

export function formatVoltageInput(mv: number): string {
  return `${Number.isInteger(mv / 1000) ? mv / 1000 : (mv / 1000).toFixed(2)} V`;
}

export function formatCurrentInput(ma: number): string {
  return ma >= 1000 && ma % 1000 === 0 ? `${ma / 1000} A` : `${ma} mA`;
}

export function formatPowerInput(watts: number): string {
  return `${watts} W`;
}

export function formatTelemetryValue(
  value: number | null,
  unit: "V" | "A" | "W",
): string {
  if (value === null) {
    return `--.-${unit}`;
  }
  return `${(value / 1000).toFixed(2)}${unit}`;
}

type UnitSliderFieldProps = {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  parseValue: (raw: string) => number | null;
  formatValue: (value: number) => string;
  step: number;
  value: number;
};

export function UnitSliderField({
  disabled = false,
  label,
  max,
  min,
  onChange,
  parseValue,
  formatValue,
  step,
  value,
}: UnitSliderFieldProps) {
  const [draft, setDraft] = useState(() => formatValue(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatValue(value));
    }
  }, [focused, formatValue, value]);

  const commitValue = (nextValue: number) => {
    onChange(clamp(quantize(nextValue, step), min, max));
  };

  return (
    <label className="grid gap-2 text-[13px]">
      <span className="font-medium text-[var(--muted)]">{label}</span>
      <span className="grid grid-cols-[minmax(0,1fr)_118px] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
        <input
          className="accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => commitValue(Number(event.target.value))}
          step={step}
          type="range"
          value={value}
        />
        <input
          className="h-10 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 text-[14px] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onBlur={() => {
            setFocused(false);
            setDraft(formatValue(value));
          }}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            const parsed = parseValue(nextDraft);
            if (parsed !== null) {
              commitValue(parsed);
            }
          }}
          onClick={(event) => event.currentTarget.select()}
          onFocus={(event) => {
            setFocused(true);
            event.currentTarget.select();
          }}
          type="text"
          value={draft}
        />
      </span>
    </label>
  );
}

export function InlineHelpPopover({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current) {
        return;
      }
      if (ref.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-label={`${title} help`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-[11px] font-bold text-[var(--muted)] transition hover:text-[var(--text)]"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        ?
      </button>
      {open ? (
        <div className="iso-popover absolute left-0 top-full z-20 mt-2 w-[min(320px,calc(100vw-3rem))]">
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <div className="text-[12px] font-semibold text-[var(--text)]">
              {title}
            </div>
            <div className="mt-2 grid gap-2 text-[12px] leading-5 text-[var(--muted)]">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PopoverPosition = {
  left: number;
  top: number;
};

function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
      setPosition({
        left: Math.min(rect.left, maxLeft),
        top: rect.bottom + 6,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  return position;
}

function PopoverPortal({
  open,
  anchorRef,
  className,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  className: string;
  children: ReactNode;
}) {
  const position = usePopoverPosition(open, anchorRef);

  if (!open || !position) {
    return null;
  }

  return createPortal(
    <div
      className={`iso-popover protocol-control-menu ${className}`}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function CompactSelectField({
  disabled = false,
  summary,
  menuTitle,
  value,
  options,
  onChange,
}: {
  disabled?: boolean;
  summary: string;
  menuTitle?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        className="protocol-control-trigger"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        title={summary}
        type="button"
      >
        <span className="truncate">{summary}</span>
        <span className="protocol-control-caret">▾</span>
      </button>
      <PopoverPortal
        anchorRef={triggerRef}
        className="min-w-[7rem]"
        open={open}
      >
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)]">
          {menuTitle ? (
            <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.03em] text-[var(--muted)]">
              {menuTitle}
            </div>
          ) : null}
          <div className="grid gap-1">
            {options.map((option) => (
              <button
                className={`flex min-h-8 items-center justify-between rounded-[6px] px-2 text-[11px] text-left ${
                  option.value === value
                    ? "bg-[var(--panel-2)] font-semibold text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
                }`}
                key={option.value}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                <span>{option.label}</span>
                {option.value === value ? <span>•</span> : null}
              </button>
            ))}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

export function CompactMultiSelectField({
  disabled = false,
  summary,
  menuTitle,
  options,
  onToggle,
}: {
  disabled?: boolean;
  summary: string;
  menuTitle?: string;
  options: Array<{ value: string; label: string; selected: boolean }>;
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        className="protocol-control-trigger"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        title={summary}
        type="button"
      >
        <span className="truncate">{summary}</span>
        <span className="protocol-control-caret">▾</span>
      </button>
      <PopoverPortal
        anchorRef={triggerRef}
        className="min-w-[11rem] max-w-[14rem]"
        open={open}
      >
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-2 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)]">
          {menuTitle ? (
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.03em] text-[var(--muted)]">
              {menuTitle}
            </div>
          ) : null}
          <div className="grid gap-1">
            {options.map((option) => (
              <label
                className="flex min-h-8 items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[11px] text-[var(--text)] hover:bg-[var(--panel-2)]"
                key={option.value}
              >
                <span>{option.label}</span>
                <input
                  checked={option.selected}
                  className="h-4 w-4 accent-[var(--primary)]"
                  onChange={() => onToggle(option.value)}
                  onClick={(event) => event.stopPropagation()}
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        </div>
      </PopoverPortal>
    </div>
  );
}

export function CompactOptionsRow({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter((child) => child != null);

  if (items.length === 0) {
    return null;
  }

  return <div className="protocol-options-row">{items}</div>;
}

export function protocolCardState({
  active,
  checked,
}: {
  active: boolean;
  checked: boolean;
}) {
  if (active) {
    return {
      dataState: "active",
      className:
        "border-[1.5px] border-[var(--protocol-active-ring)] bg-[linear-gradient(180deg,var(--protocol-active-top),var(--protocol-active-bg))] shadow-[inset_0_1px_0_var(--protocol-active-inner-highlight),0_1px_0_rgba(255,255,255,0.03)]",
    };
  }
  if (checked) {
    return {
      dataState: "enabled",
      className:
        "border-[var(--protocol-enabled-ring)] bg-[linear-gradient(180deg,var(--protocol-enabled-top),var(--protocol-enabled-bg))] shadow-[inset_0_1px_0_var(--protocol-enabled-inner-highlight)]",
    };
  }
  return {
    dataState: "off",
    className: "border-[var(--border-subtle)] bg-[var(--panel)]",
  };
}
