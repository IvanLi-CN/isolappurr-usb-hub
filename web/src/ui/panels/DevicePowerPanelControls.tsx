import {
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

export const TPS_CABLE_LOOP_COMPENSATION_MAX_MOHM = 140;
export const SW2303_CABLE_LOOP_COMPENSATION_MAX_MOHM = 150;

export type CableLoopCompensationRecommendation = {
  measuredMohm: number;
  recommendedMohm: number;
  clamped: boolean;
};

export function cloneConfig(config: PowerConfigResponse): FormState {
  return {
    hardware: "sw2303",
    tps_mode: config.tps_mode,
    light_load_mode: config.light_load_mode,
    sw2303_line_compensation: config.sw2303_line_compensation,
    capability: config.capability,
    manual: {
      voltage_mv: config.manual.voltage_mv,
      current_limit_ma: config.manual.current_limit_ma,
      usb_c_path_mode: config.manual.usb_c_path_mode,
      tps_cdc_rise_mv: config.manual.tps_cdc_rise_mv,
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

export function formatTpsCdcOption(mv: number): string {
  return `${tpsCdcRiseToCableLoopResistanceMohm(mv)}mΩ`;
}

export function tpsCdcRiseToCableLoopResistanceMohm(riseMv: number): number {
  return riseMv / 5;
}

export function cableLoopResistanceMohmToTpsCdcRise(
  resistanceMohm: number,
): FormState["manual"]["tps_cdc_rise_mv"] {
  return (resistanceMohm * 5) as FormState["manual"]["tps_cdc_rise_mv"];
}

export function calculateCableLoopCompensation(
  voltageDropMv: number,
  loadCurrentMa: number,
  stepMohm: number,
  maxMohm: number,
): CableLoopCompensationRecommendation | null {
  if (
    !Number.isFinite(voltageDropMv) ||
    !Number.isFinite(loadCurrentMa) ||
    voltageDropMv < 0 ||
    loadCurrentMa <= 0
  ) {
    return null;
  }

  const measuredMohm = (voltageDropMv * 1000) / loadCurrentMa;
  const clamped = measuredMohm > maxMohm;
  return {
    measuredMohm,
    recommendedMohm: Math.min(
      maxMohm,
      Math.floor(measuredMohm / stepMohm) * stepMohm,
    ),
    clamped,
  };
}

export function formatSw2303LineCompensation(
  value: FormState["sw2303_line_compensation"],
): string {
  switch (value) {
    case "off":
      return "Off";
    case "0mohm":
      return "0mΩ";
    case "100mohm":
      return "100mΩ";
    case "150mohm":
      return "150mΩ";
    default:
      return "50mΩ";
  }
}

export function CableLoopCompensationCalculator({
  disabled = false,
  label,
  maxMohm,
  onRecommend,
  stepMohm,
}: {
  disabled?: boolean;
  label: string;
  maxMohm: number;
  onRecommend: (resistanceMohm: number) => void;
  stepMohm: number;
}) {
  const [voltageDropMv, setVoltageDropMv] = useState("");
  const [loadCurrentMa, setLoadCurrentMa] = useState("");
  const recommendationFor = (
    nextVoltageDropMv: string,
    nextLoadCurrentMa: string,
  ) => {
    if (nextVoltageDropMv.trim() === "" || nextLoadCurrentMa.trim() === "") {
      return null;
    }
    return calculateCableLoopCompensation(
      Number(nextVoltageDropMv),
      Number(nextLoadCurrentMa),
      stepMohm,
      maxMohm,
    );
  };
  const recommendation = recommendationFor(voltageDropMv, loadCurrentMa);

  const updateValues = (
    nextVoltageDropMv: string,
    nextLoadCurrentMa: string,
  ) => {
    setVoltageDropMv(nextVoltageDropMv);
    setLoadCurrentMa(nextLoadCurrentMa);
    const nextRecommendation = recommendationFor(
      nextVoltageDropMv,
      nextLoadCurrentMa,
    );
    if (nextRecommendation) {
      onRecommend(nextRecommendation.recommendedMohm);
    }
  };

  return (
    <div className="mt-3 grid gap-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="text-[12px] font-semibold text-[var(--text)]">
        Measure cable loop resistance
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-[11px] text-[var(--muted)]">
          <span>Voltage drop (mV)</span>
          <input
            aria-label={`${label} voltage drop`}
            className="h-9 rounded-[6px] border border-[var(--border)] bg-[var(--panel-3)] px-2 text-[12px] text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            min="0"
            onChange={(event) =>
              updateValues(event.target.value, loadCurrentMa)
            }
            step="any"
            type="number"
            value={voltageDropMv}
          />
        </label>
        <label className="grid gap-1 text-[11px] text-[var(--muted)]">
          <span>Load current (mA)</span>
          <input
            aria-label={`${label} load current`}
            className="h-9 rounded-[6px] border border-[var(--border)] bg-[var(--panel-3)] px-2 text-[12px] text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            min="0"
            onChange={(event) =>
              updateValues(voltageDropMv, event.target.value)
            }
            step="any"
            type="number"
            value={loadCurrentMa}
          />
        </label>
      </div>
      <output
        aria-live="polite"
        className="text-[11px] leading-5 text-[var(--muted)]"
      >
        {recommendation
          ? recommendation.clamped
            ? `Measured ${formatResistance(recommendation.measuredMohm)}. Limited to ${recommendation.recommendedMohm}mΩ; some voltage drop remains uncompensated.`
            : `Measured ${formatResistance(recommendation.measuredMohm)}. The unsaved setting now uses ${recommendation.recommendedMohm}mΩ.`
          : "Enter a non-negative voltage drop and a positive load current. The unsaved setting updates automatically."}
      </output>
    </div>
  );
}

function formatResistance(valueMohm: number): string {
  return `${Number(valueMohm.toFixed(1))}mΩ`;
}

export function formatPowerInput(watts: number): string {
  return `${watts} W`;
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

export function DiscreteSliderField({
  disabled = false,
  hideLabel = false,
  label,
  labelAccessory,
  showValue = true,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  hideLabel?: boolean;
  label: string;
  labelAccessory?: ReactNode;
  showValue?: boolean;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string; valueLabel?: string }>;
  value: string;
}) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const lastIndex = Math.max(1, options.length - 1);

  return (
    <div className="grid gap-1.5 text-[13px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={
              hideLabel ? "sr-only" : "font-medium text-[var(--muted)]"
            }
          >
            {label}
          </span>
          {hideLabel ? null : labelAccessory}
        </div>
        {showValue ? (
          <span
            className={`inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] font-semibold text-[var(--text)] ${
              disabled ? "opacity-60" : ""
            }`}
          >
            {selectedOption?.valueLabel ?? selectedOption?.label}
          </span>
        ) : null}
      </div>
      <input
        aria-label={label}
        className="w-full accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        max={Math.max(0, options.length - 1)}
        min={0}
        onChange={(event) =>
          onChange(options[Number(event.target.value)]?.value ?? value)
        }
        step={1}
        type="range"
        value={selectedIndex}
      />
      <div className="relative h-4">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              className={`absolute top-0 min-w-0 bg-transparent px-0 text-center text-[11px] font-semibold leading-4 ${
                selected ? "text-[var(--text)]" : "text-[var(--muted)]"
              } ${disabled ? "opacity-60" : "hover:text-[var(--text)]"}`}
              disabled={disabled}
              key={option.value}
              onClick={() => onChange(option.value)}
              style={{
                left: `${(index / lastIndex) * 100}%`,
                transform:
                  index === 0
                    ? "translateX(0)"
                    : index === lastIndex
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
              }}
              type="button"
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function InlineHelpPopover({
  children,
  title,
  lines,
}: {
  children?: ReactNode;
  title: string;
  lines: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(open, triggerRef, {
    height: 440,
    width: 360,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        ref.current?.contains(event.target as Node) ||
        popoverRef.current?.contains(event.target as Node)
      ) {
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
        ref={triggerRef}
        type="button"
      >
        ?
      </button>
      {open && position
        ? createPortal(
            <div
              className="iso-popover fixed z-50 w-[min(360px,calc(100vw-24px))]"
              ref={popoverRef}
              style={{ left: `${position.left}px`, top: `${position.top}px` }}
            >
              <div className="max-h-[calc(100dvh-24px)] overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-3">
                <div className="text-[12px] font-semibold text-[var(--text)]">
                  {title}
                </div>
                <div className="mt-2 grid gap-2 text-[12px] leading-5 text-[var(--muted)]">
                  {lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
                {children}
              </div>
            </div>,
            document.body,
          )
        : null}
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
  viewportBounds?: { height?: number; width?: number },
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
      const width = Math.min(
        viewportBounds?.width ?? rect.width,
        window.innerWidth - 24,
      );
      const maxLeft = Math.max(12, window.innerWidth - width - 12);
      const preferredTop = rect.bottom + 6;
      const height = viewportBounds?.height ?? 0;
      const top =
        height > 0 && preferredTop + height > window.innerHeight - 12
          ? Math.max(12, rect.top - height - 6)
          : preferredTop;
      setPosition({
        left: Math.max(12, Math.min(rect.left, maxLeft)),
        top,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, viewportBounds?.height, viewportBounds?.width]);

  return position;
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
