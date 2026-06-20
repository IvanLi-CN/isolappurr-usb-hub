import {
  Children,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { getStablePowerLockOwner } from "../../app/device-runtime-support";
import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigManualInput,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";
import type { PortState, PortTelemetry } from "../../domain/ports";
import { DevicePowerPanelIdleBiasSection } from "./DevicePowerPanelIdleBiasSection";

const HEARTBEAT_MS = 8_000;

type DevicePowerPanelProps = {
  deviceKey: string;
  deviceName: string;
  transportLabel: string;
  localAdvancedLocked: boolean;
  loadPowerConfig: () => Promise<Result<PowerConfigResponse>>;
  loadIdleBias: () => Promise<Result<IdleBiasResponse>>;
  savePowerConfig: (
    input: PowerConfigInput,
    owner: number,
  ) => Promise<Result<PowerConfigResponse>>;
  restorePowerDefaults: (owner: number) => Promise<Result<PowerConfigResponse>>;
  setPowerLock: (
    owner: number,
    acquire: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setPowerRuntime: (
    owner: number,
    action: "output" | "discharge",
    enabled: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setIdleBiasCorrection: (
    enabled: boolean,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  runIdleBiasCalibration: (owner: number) => Promise<Result<IdleBiasResponse>>;
  clearIdleBiasCalibration: (
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  loadPdDiagnostics: () => Promise<Result<PdDiagnosticsResponse>>;
  usbCTelemetry: PortTelemetry | null;
  usbCState: PortState | null;
  usbCPending: boolean;
  replugUsbC: () => Promise<void>;
};

type FormState = PowerConfigInput;
type NegotiationChannel = "cc" | "dpdm";

type ActiveProtocol = NonNullable<PdDiagnosticsResponse["active_protocol"]>;

function cloneConfig(config: PowerConfigResponse): FormState {
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

function badgeTone(enabled: boolean): string {
  return enabled
    ? "border border-[var(--surface-success-ring)] bg-[var(--surface-success-bg)] text-[var(--badge-success-text)]"
    : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]";
}

function negotiationBadgeLabel(channel: NegotiationChannel): string {
  return channel === "cc" ? "CC" : "DPDM";
}

function formatVoltageOption(mv: number): string {
  return `${mv / 1000}V`;
}

function boolLabel(enabled: boolean): string {
  return enabled ? "On" : "Off";
}

function formatCompactCurrent(ma: number): string {
  const amps = ma / 1000;
  return `${Number.isInteger(amps) ? amps : Number(amps.toFixed(2))}A`;
}

function formatFixedVoltageSummary(voltagesMv: number[]): string {
  if (voltagesMv.length === 0) {
    return "PDO Off";
  }
  if (voltagesMv.length === 1) {
    return `${voltagesMv[0] / 1000}V`;
  }
  return `${voltagesMv.length} PDO`;
}

function activeProtocolLabel(protocol: ActiveProtocol | null): string | null {
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

function parseVoltageInput(raw: string): number | null {
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

function parseCurrentInput(raw: string): number | null {
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

function parsePowerInput(raw: string): number | null {
  const parsed = parseUnitNumber(raw);
  if (!parsed || (parsed.unit !== "" && parsed.unit !== "w")) {
    return null;
  }
  return parsed.value;
}

function formatVoltageInput(mv: number): string {
  return `${Number.isInteger(mv / 1000) ? mv / 1000 : (mv / 1000).toFixed(2)} V`;
}

function formatCurrentInput(ma: number): string {
  return ma >= 1000 && ma % 1000 === 0 ? `${ma / 1000} A` : `${ma} mA`;
}

function formatPowerInput(watts: number): string {
  return `${watts} W`;
}

function formatTelemetryValue(
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

function UnitSliderField({
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

function InlineHelpPopover({
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
  anchorRef: React.RefObject<HTMLElement | null>,
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
  anchorRef: React.RefObject<HTMLElement | null>;
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

function CompactSelectField({
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

function CompactMultiSelectField({
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

function CompactOptionsRow({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter((child) => child != null);

  if (items.length === 0) {
    return null;
  }

  return <div className="protocol-options-row">{items}</div>;
}

function protocolCardState({
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

export function DevicePowerPanel({
  deviceKey,
  deviceName,
  transportLabel,
  localAdvancedLocked,
  loadPowerConfig,
  loadIdleBias,
  savePowerConfig,
  restorePowerDefaults,
  setPowerLock,
  setPowerRuntime,
  setIdleBiasCorrection,
  runIdleBiasCalibration,
  clearIdleBiasCalibration,
  loadPdDiagnostics,
  usbCTelemetry,
  usbCState,
  usbCPending,
  replugUsbC,
}: DevicePowerPanelProps) {
  const [config, setConfig] = useState<PowerConfigResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [idleBiasSnapshot, setIdleBiasSnapshot] =
    useState<IdleBiasResponse | null>(null);
  const [pdDiagnostics, setPdDiagnostics] =
    useState<PdDiagnosticsResponse | null>(null);
  const [idleBiasBusy, setIdleBiasBusy] = useState(false);
  const [idleBiasRunning, setIdleBiasRunning] = useState(false);
  const lockedRef = useRef(false);
  const loadPowerConfigRef = useRef(loadPowerConfig);
  const loadIdleBiasRef = useRef(loadIdleBias);
  const loadPdDiagnosticsRef = useRef(loadPdDiagnostics);
  const setPowerLockRef = useRef(setPowerLock);
  const setPowerRuntimeRef = useRef(setPowerRuntime);
  const ownerRef = useRef(getStablePowerLockOwner(deviceKey));

  const initializeLoadedConfig = useCallback(
    (nextConfig: PowerConfigResponse) => {
      setConfig(nextConfig);
      setForm((current) => current ?? cloneConfig(nextConfig));
      setError(null);
    },
    [],
  );

  useEffect(() => {
    loadPowerConfigRef.current = loadPowerConfig;
  }, [loadPowerConfig]);

  useEffect(() => {
    loadIdleBiasRef.current = loadIdleBias;
  }, [loadIdleBias]);

  useEffect(() => {
    loadPdDiagnosticsRef.current = loadPdDiagnostics;
  }, [loadPdDiagnostics]);

  useEffect(() => {
    setPowerLockRef.current = setPowerLock;
  }, [setPowerLock]);

  useEffect(() => {
    setPowerRuntimeRef.current = setPowerRuntime;
  }, [setPowerRuntime]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      const configRes = await loadPowerConfigRef.current();
      if (cancelled) {
        return;
      }
      if (configRes.ok) {
        initializeLoadedConfig(configRes.value);
      } else {
        setError(configRes.error.message);
      }
    };
    const loadIdleBiasSnapshot = async () => {
      const idleBiasRes = await loadIdleBiasRef.current();
      if (cancelled) {
        return;
      }
      if (idleBiasRes.ok) {
        setIdleBiasSnapshot(idleBiasRes.value);
        setIdleBiasRunning(idleBiasRes.value.run.state === "running");
      } else {
        setIdleBiasSnapshot(null);
        setIdleBiasRunning(false);
      }
    };
    const loadPdSnapshot = async () => {
      const pdRes = await loadPdDiagnosticsRef.current();
      if (cancelled) {
        return;
      }
      if (pdRes.ok) {
        setPdDiagnostics(pdRes.value);
      } else {
        setPdDiagnostics(null);
      }
    };
    void loadConfig();
    void loadIdleBiasSnapshot();
    void loadPdSnapshot();
    return () => {
      cancelled = true;
    };
  }, [initializeLoadedConfig]);

  useEffect(() => {
    if (form || transportLabel === "unknown") {
      return;
    }
    let cancelled = false;
    const retry = async () => {
      const configRes = await loadPowerConfigRef.current();
      if (cancelled || !configRes.ok) {
        return;
      }
      initializeLoadedConfig(configRes.value);
    };
    void retry();
    return () => {
      cancelled = true;
    };
  }, [form, initializeLoadedConfig, transportLabel]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!lockedRef.current) {
        return;
      }
      const res = await setPowerLockRef.current(ownerRef.current, true);
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setError(res.error.message);
      } else {
        setConfig(res.value);
      }
    };

    const id = window.setInterval(() => void tick(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (lockedRef.current) {
        void setPowerLockRef.current(ownerRef.current, false);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      const res = await setPowerLockRef.current(ownerRef.current, true);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        lockedRef.current = true;
        setConfig(res.value);
        setForm((current) => current ?? cloneConfig(res.value));
        setError(null);
      } else {
        setError(res.error.message);
      }
    };
    void acquire();
    return () => {
      cancelled = true;
    };
  }, []);

  const lockedByOtherHost =
    config?.lock !== null &&
    config?.lock !== undefined &&
    config.lock.owner !== ownerRef.current;
  const advancedDisabled =
    localAdvancedLocked || lockedByOtherHost || idleBiasRunning;
  const powerControlsDisabled = advancedDisabled || busy || idleBiasBusy;

  if (!form && error) {
    return (
      <section className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-6 py-8">
        <div className="max-w-[420px] text-center">
          <div className="text-[14px] font-semibold text-[var(--badge-error-text)]">
            Power settings unavailable
          </div>
          <div className="mt-2 text-[13px] text-[var(--muted)]">{error}</div>
        </div>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-6 py-8">
        <div className="text-sm text-[var(--muted)]">
          Loading power settings...
        </div>
      </section>
    );
  }

  const setTpsMode = (mode: FormState["tps_mode"]) => {
    setForm((current) => (current ? { ...current, tps_mode: mode } : current));
    setDirty(true);
  };

  const setLightLoadMode = (mode: FormState["light_load_mode"]) => {
    setForm((current) =>
      current ? { ...current, light_load_mode: mode } : current,
    );
    setDirty(true);
  };

  const setManualNumber = (
    key: "voltage_mv" | "current_limit_ma",
    value: number,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            manual: {
              ...current.manual,
              [key]: Number.isFinite(value) ? value : current.manual[key],
            },
          }
        : current,
    );
    setDirty(true);
  };

  const setPowerWatts = (value: number) => {
    setForm((current) =>
      current
        ? {
            ...current,
            capability: {
              ...current.capability,
              power_watts: value,
            },
          }
        : current,
    );
    setDirty(true);
  };

  const setPathMode = (mode: PowerConfigManualInput["usb_c_path_mode"]) => {
    setForm((current) =>
      current
        ? { ...current, manual: { ...current.manual, usb_c_path_mode: mode } }
        : current,
    );
    setDirty(true);
  };

  const setProtocol = (
    key: keyof FormState["capability"]["protocols"],
    value: boolean,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            capability: {
              ...current.capability,
              protocols: { ...current.capability.protocols, [key]: value },
            },
          }
        : current,
    );
    setDirty(true);
  };

  const setPps = (value: boolean) => {
    setForm((current) =>
      current
        ? {
            ...current,
            capability: {
              ...current.capability,
              pd: {
                ...current.capability.pd,
                pps: value,
              },
            },
          }
        : current,
    );
    setDirty(true);
  };

  const setCurrentProfile = (
    key: keyof FormState["capability"]["current"],
    value: number | boolean,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            capability: {
              ...current.capability,
              current: {
                ...current.capability.current,
                [key]: value,
              },
            },
          }
        : current,
    );
    setDirty(true);
  };

  const setFastChargeConfig = (
    key: keyof FormState["capability"]["fast_charge"],
    value: boolean,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            capability: {
              ...current.capability,
              fast_charge: {
                ...current.capability.fast_charge,
                [key]: value,
              },
            },
          }
        : current,
    );
    setDirty(true);
  };

  const toggleFixedVoltage = (mv: number) => {
    setForm((current) => {
      if (!current) {
        return current;
      }
      const exists = current.capability.pd.fixed_voltages_mv.includes(mv);
      const fixed_voltages_mv = exists
        ? current.capability.pd.fixed_voltages_mv.filter(
            (value) => value !== mv,
          )
        : [...current.capability.pd.fixed_voltages_mv, mv].sort(
            (a, b) => a - b,
          );
      return {
        ...current,
        capability: {
          ...current.capability,
          pd: {
            ...current.capability.pd,
            fixed_voltages_mv,
          },
        },
      };
    });
    setDirty(true);
  };

  const activeProtocol = pdDiagnostics?.active_protocol ?? null;
  const fixedVoltageSummary = formatFixedVoltageSummary(
    form.capability.pd.fixed_voltages_mv,
  );

  const submit = async () => {
    setBusy(true);
    setStatus("Saving and applying power configuration...");
    setError(null);
    const res = await savePowerConfig(form, ownerRef.current);
    setBusy(false);
    if (res.ok) {
      setConfig(res.value);
      setForm(cloneConfig(res.value));
      setDirty(false);
      setStatus("Saved and applied");
    } else {
      setError(res.error.message);
      setStatus(null);
    }
  };

  const restore = async () => {
    setBusy(true);
    setStatus("Restoring defaults...");
    setError(null);
    const res = await restorePowerDefaults(ownerRef.current);
    setBusy(false);
    if (res.ok) {
      setConfig(res.value);
      setForm(cloneConfig(res.value));
      setDirty(false);
      setStatus("Defaults restored");
    } else {
      setError(res.error.message);
      setStatus(null);
    }
  };

  const toggleRuntime = async (
    action: "output" | "discharge",
    enabled: boolean,
  ) => {
    setBusy(true);
    setStatus(
      action === "output"
        ? `${enabled ? "Enabling" : "Disabling"} Power...`
        : `${enabled ? "Enabling" : "Disabling"} TPS discharge...`,
    );
    setError(null);
    const res = await setPowerRuntimeRef.current(
      ownerRef.current,
      action,
      enabled,
    );
    setBusy(false);
    if (res.ok) {
      setConfig(res.value);
      setStatus(
        action === "output"
          ? `Power ${enabled ? "enabled" : "disabled"}`
          : `TPS discharge ${enabled ? "enabled" : "disabled"}`,
      );
    } else {
      setError(res.error.message);
      setStatus(null);
    }
  };

  const runtimeOutputEnabled = config?.runtime?.output_enabled ?? true;
  const runtimeDischargeEnabled = config?.runtime?.discharge_enabled ?? false;
  const manualHighVoltageWarning =
    form.tps_mode === "manual" && form.manual.voltage_mv > 5000;
  const usbCPowerActionDisabled = powerControlsDisabled || usbCPending;
  const usbCPowerEnabled = runtimeOutputEnabled;
  const usbCDataLinked =
    usbCState?.replugging === true
      ? "Replugging"
      : usbCState?.data_connected
        ? "Data linked"
        : "Data off";

  return (
    <section
      className="flex flex-col gap-5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5"
      data-testid="device-power-panel"
    >
      <header className="flex flex-col gap-2 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold">USB-C / Power</div>
          <div className="mt-1 text-[13px] text-[var(--muted)]">
            {deviceName} · active transport {transportLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className={`inline-flex h-7 items-center rounded-full px-3 font-semibold ${config?.persisted ? badgeTone(true) : badgeTone(false)}`}
          >
            {config?.persisted ? "EEPROM saved" : "Unsaved default"}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-full border px-3 font-semibold ${lockedByOtherHost ? "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"}`}
          >
            {lockedByOtherHost ? "Host lock active" : "Host lock idle"}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-full border px-3 font-semibold ${idleBiasRunning ? "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"}`}
          >
            {idleBiasRunning ? "Calibration running" : "Calibration idle"}
          </span>
        </div>
      </header>

      <div className="grid gap-5">
        <section className="grid gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[14px] font-semibold">Safe profile</div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Source capability stays on SW2303. Changes save to EEPROM and
                apply immediately.
              </div>
            </div>
          </div>
          <UnitSliderField
            disabled={powerControlsDisabled}
            formatValue={formatPowerInput}
            label="Power cap"
            max={100}
            min={1}
            onChange={setPowerWatts}
            parseValue={parsePowerInput}
            step={1}
            value={form.capability.power_watts}
          />
          <div className="protocol-grid grid items-start gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                key: "pd",
                label: "PD",
                negotiation: "cc" as const,
                checked: form.capability.protocols.pd,
                toggle: () => setProtocol("pd", !form.capability.protocols.pd),
                active: activeProtocol === "pd",
              },
              {
                key: "pps",
                label: "PPS",
                negotiation: "cc" as const,
                checked: form.capability.pd.pps,
                toggle: () => setPps(!form.capability.pd.pps),
                active: activeProtocol === "pps",
              },
              {
                key: "qc20",
                label: "QC2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.qc20,
                toggle: () =>
                  setProtocol("qc20", !form.capability.protocols.qc20),
                active: activeProtocol === "qc20",
              },
              {
                key: "qc30",
                label: "QC3",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.qc30,
                toggle: () =>
                  setProtocol("qc30", !form.capability.protocols.qc30),
                active: activeProtocol === "qc30",
              },
              {
                key: "fcp",
                label: "FCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.fcp,
                toggle: () =>
                  setProtocol("fcp", !form.capability.protocols.fcp),
                active: activeProtocol === "fcp",
              },
              {
                key: "afc",
                label: "AFC",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.afc,
                toggle: () =>
                  setProtocol("afc", !form.capability.protocols.afc),
                active: activeProtocol === "afc",
              },
              {
                key: "scp",
                label: "SCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.scp,
                toggle: () =>
                  setProtocol("scp", !form.capability.protocols.scp),
                active: activeProtocol === "scp",
              },
              {
                key: "pe20",
                label: "PE2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.pe20,
                toggle: () =>
                  setProtocol("pe20", !form.capability.protocols.pe20),
                active: activeProtocol === "pe20",
              },
              {
                key: "bc12",
                label: "BC1.2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.bc12,
                toggle: () =>
                  setProtocol("bc12", !form.capability.protocols.bc12),
                active: activeProtocol === "bc12",
              },
              {
                key: "sfcp",
                label: "SFCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.sfcp,
                toggle: () =>
                  setProtocol("sfcp", !form.capability.protocols.sfcp),
                active: activeProtocol === "sfcp",
              },
            ].map((protocol) => (
              <div
                className={`protocol-card flex flex-col gap-2 rounded-[8px] border px-2.5 py-2 transition sm:gap-1 sm:px-2 sm:py-1.5 ${
                  protocolCardState({
                    active: protocol.active,
                    checked: protocol.checked,
                  }).className
                } ${powerControlsDisabled ? "opacity-60" : ""}`}
                data-state={
                  protocolCardState({
                    active: protocol.active,
                    checked: protocol.checked,
                  }).dataState
                }
                key={protocol.key}
              >
                <button
                  className="protocol-card-toggle flex w-full min-w-0 items-center justify-between gap-2 text-left"
                  disabled={powerControlsDisabled}
                  onClick={protocol.toggle}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold sm:text-[13px]">
                      {protocol.label}
                    </span>
                    <span
                      className="protocol-negotiation-badge h-5 shrink-0 items-center rounded-full border border-current/15 bg-[var(--panel)] px-1.5 text-[9px] font-bold uppercase tracking-[0.03em]"
                      data-testid={`${protocol.label}-negotiation-badge`}
                    >
                      {negotiationBadgeLabel(protocol.negotiation)}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.05em] sm:h-5 sm:px-2 sm:text-[9px] ${
                        protocol.active
                          ? "border border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] text-[var(--protocol-live-text)]"
                          : protocol.checked
                            ? "border border-[var(--protocol-on-badge-border)] bg-[var(--protocol-on-badge-bg)] text-[var(--protocol-on-badge-text)]"
                            : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
                      }`}
                    >
                      {protocol.active
                        ? activeProtocolLabel(activeProtocol)
                        : protocol.checked
                          ? "On"
                          : "Off"}
                    </span>
                  </div>
                </button>
                <CompactOptionsRow>
                  {protocol.key === "pd" ? (
                    <CompactMultiSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Fixed PDO"
                      onToggle={(value) => toggleFixedVoltage(Number(value))}
                      options={[9000, 12000, 15000, 20000].map((value) => ({
                        value: String(value),
                        label: formatVoltageOption(value),
                        selected:
                          form.capability.pd.fixed_voltages_mv.includes(value),
                      }))}
                      summary={fixedVoltageSummary}
                    />
                  ) : null}
                  {protocol.key === "pps" ? (
                    <>
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="PPS3 current"
                        onChange={(value) =>
                          setCurrentProfile("pps3_limit_ma", Number(value))
                        }
                        options={[
                          { label: "3A", value: "3000" },
                          { label: "5A", value: "5000" },
                        ]}
                        summary={`P3 ${formatCompactCurrent(form.capability.current.pps3_limit_ma)}`}
                        value={String(form.capability.current.pps3_limit_ma)}
                      />
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="PPS 5A"
                        onChange={(value) =>
                          setCurrentProfile("pd_pps_5a", value === "true")
                        }
                        options={[
                          { label: "Off", value: "false" },
                          { label: "On", value: "true" },
                        ]}
                        summary={`5A ${boolLabel(form.capability.current.pd_pps_5a)}`}
                        value={String(form.capability.current.pd_pps_5a)}
                      />
                    </>
                  ) : null}
                  {protocol.key === "qc20" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "qc20_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.qc20_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.qc20_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "qc30" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "qc30_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.qc30_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.qc30_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "fcp" ||
                  protocol.key === "afc" ||
                  protocol.key === "sfcp" ? (
                    <>
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="Current"
                        onChange={(value) =>
                          setCurrentProfile(
                            "fcp_afc_sfcp_limit_ma",
                            Number(value),
                          )
                        }
                        options={[
                          { label: "2.25A", value: "2250" },
                          { label: "3.25A", value: "3250" },
                        ]}
                        summary={formatCompactCurrent(
                          form.capability.current.fcp_afc_sfcp_limit_ma,
                        )}
                        value={String(
                          form.capability.current.fcp_afc_sfcp_limit_ma,
                        )}
                      />
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="12V profile"
                        onChange={(value) =>
                          setFastChargeConfig(
                            "non_pd_12v_enabled",
                            value === "true",
                          )
                        }
                        options={[
                          { label: "Off", value: "false" },
                          { label: "On", value: "true" },
                        ]}
                        summary={`12V ${boolLabel(form.capability.fast_charge.non_pd_12v_enabled)}`}
                        value={String(
                          form.capability.fast_charge.non_pd_12v_enabled,
                        )}
                      />
                    </>
                  ) : null}
                  {protocol.key === "scp" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Current"
                      onChange={(value) =>
                        setCurrentProfile("scp_limit_ma", Number(value))
                      }
                      options={[
                        { label: "2A", value: "2000" },
                        { label: "4A", value: "4000" },
                        { label: "5A", value: "5000" },
                      ]}
                      summary={formatCompactCurrent(
                        form.capability.current.scp_limit_ma,
                      )}
                      value={String(form.capability.current.scp_limit_ma)}
                    />
                  ) : null}
                  {protocol.key === "pe20" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "pe20_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.pe20_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.pe20_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "bc12" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Type-C broadcast"
                      onChange={(value) =>
                        setCurrentProfile("type_c_broadcast_ma", Number(value))
                      }
                      options={[
                        { label: "500mA", value: "500" },
                        { label: "1.5A", value: "1500" },
                      ]}
                      summary={formatCurrentInput(
                        form.capability.current.type_c_broadcast_ma,
                      ).replace(" ", "")}
                      value={String(
                        form.capability.current.type_c_broadcast_ma,
                      )}
                    />
                  ) : null}
                </CompactOptionsRow>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <section className="grid gap-4 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-2)] px-4 py-4">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Output mode</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  Manual TPS output is only for advanced bench work. USB-C path
                  policy stays explicit.
                </div>
              </div>
              <div className="inline-flex h-9 w-full rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-3)] p-1 sm:w-auto">
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "auto_follow" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setTpsMode("auto_follow")}
                  type="button"
                >
                  Auto follow
                </button>
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "manual" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setTpsMode("manual")}
                  type="button"
                >
                  Manual TPS
                </button>
              </div>
            </div>

            <div className="grid gap-4">
              <UnitSliderField
                disabled={powerControlsDisabled || form.tps_mode !== "manual"}
                formatValue={formatVoltageInput}
                label="Voltage"
                max={21000}
                min={3000}
                onChange={(value) => setManualNumber("voltage_mv", value)}
                parseValue={parseVoltageInput}
                step={20}
                value={form.manual.voltage_mv}
              />
              <UnitSliderField
                disabled={powerControlsDisabled || form.tps_mode !== "manual"}
                formatValue={formatCurrentInput}
                label="Current limit"
                max={6350}
                min={1000}
                onChange={(value) => setManualNumber("current_limit_ma", value)}
                parseValue={parseCurrentInput}
                step={50}
                value={form.manual.current_limit_ma}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted)]">
                <span>USB-C path</span>
                <InlineHelpPopover
                  lines={[
                    "Default disconnects only while manual voltage exceeds the negotiated SW2303 request.",
                    "Disconnect forces the SW2303 VBUS path off.",
                    "Force keeps USB-C VBUS connected to TPS VOUT.",
                    "Manual voltage above 5 V can still run hot, prefer Auto follow for sustained high-voltage use.",
                  ]}
                  title="USB-C path"
                />
                {manualHighVoltageWarning ? (
                  <span className="rounded-full border border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--badge-warning-text)]">
                    High voltage
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2 lg:grid-cols-3">
                {[
                  ["default", "Default", "Above request"],
                  ["disconnect", "Disconnect", "VBUS off"],
                  ["force", "Force", "VBUS on"],
                ].map(([value, label, detail]) => (
                  <button
                    key={value}
                    className={`flex min-h-[88px] flex-col items-start justify-between rounded-[8px] border px-3 py-3 text-left ${form.manual.usb_c_path_mode === value ? "border-[var(--primary)] bg-[var(--panel-3)]" : "border-[var(--border-subtle)] bg-[var(--panel)]"} ${powerControlsDisabled || form.tps_mode !== "manual" ? "opacity-60" : ""}`}
                    disabled={
                      powerControlsDisabled || form.tps_mode !== "manual"
                    }
                    onClick={() =>
                      setPathMode(
                        value as FormState["manual"]["usb_c_path_mode"],
                      )
                    }
                    type="button"
                  >
                    <span className="text-[13px] font-semibold">{label}</span>
                    <span className="text-[12px] leading-5 text-[var(--muted)]">
                      {detail}
                    </span>
                  </button>
                ))}
              </div>
              {form.tps_mode === "manual" ? (
                <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="text-[13px] font-semibold">
                        TPS discharge on output-off
                      </div>
                      <InlineHelpPopover
                        lines={[
                          "Advanced control for TPS55288 `DISCHG`.",
                          "Only affects the TPS output shutdown state, not SW2303 internal discharge behavior.",
                        ]}
                        title="TPS discharge"
                      />
                    </div>
                    <button
                      className={`inline-flex h-9 min-w-[104px] items-center justify-center rounded-[8px] px-3 text-[12px] font-semibold ${
                        runtimeDischargeEnabled
                          ? "bg-[var(--primary)] text-[var(--primary-text)]"
                          : "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
                      } ${
                        powerControlsDisabled || !runtimeOutputEnabled
                          ? "opacity-60"
                          : ""
                      }`}
                      data-testid="runtime-discharge-toggle"
                      disabled={powerControlsDisabled}
                      onClick={() =>
                        void toggleRuntime(
                          "discharge",
                          !runtimeDischargeEnabled,
                        )
                      }
                      type="button"
                    >
                      {runtimeDischargeEnabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 border-t border-[var(--border)] pt-4">
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  className="flex h-11 min-w-[176px] items-center justify-center rounded-[8px] bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--primary-text)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={powerControlsDisabled || !dirty}
                  onClick={() => void submit()}
                  type="button"
                >
                  Save and apply
                </button>
                <button
                  className="flex h-11 min-w-[176px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={powerControlsDisabled}
                  onClick={() => void restore()}
                  type="button"
                >
                  Restore defaults
                </button>
              </div>
              {status ? (
                <div className="text-[12px] text-[var(--muted)]">{status}</div>
              ) : null}
              {error ? (
                <div className="text-[12px] text-[var(--badge-error-text)]">
                  {error}
                </div>
              ) : null}
            </div>
          </section>

          <aside className="grid gap-5">
            <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
                <div className="text-[14px] font-semibold">USB-C</div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="flex h-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] px-3 text-[12px] font-semibold text-[var(--muted)]">
                    {formatTelemetryValue(
                      usbCTelemetry?.current_ma ?? null,
                      "A",
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid h-7 grid-cols-2 gap-2">
                <div
                  className={`flex min-w-0 items-center justify-center rounded-[8px] px-2 text-[11px] font-bold ${
                    usbCPowerEnabled
                      ? "border border-[var(--protocol-enabled-ring)] bg-[var(--protocol-enabled-bg)] text-[var(--primary-2)]"
                      : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
                  }`}
                >
                  <span className="truncate">
                    {usbCPowerEnabled ? "Power on" : "Power off"}
                  </span>
                </div>
                <div
                  className={`flex min-w-0 items-center justify-center rounded-[8px] px-2 text-[11px] font-bold ${
                    usbCState?.data_connected && usbCState?.replugging !== true
                      ? "border border-[var(--protocol-enabled-ring)] bg-[var(--protocol-enabled-bg)] text-[var(--primary-2)]"
                      : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
                  }`}
                >
                  <span className="truncate">{usbCDataLinked}</span>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Voltage
                  </div>
                  <div
                    className="mt-2 font-mono text-[24px] font-bold"
                    data-testid="usb-c-voltage"
                  >
                    {formatTelemetryValue(
                      usbCTelemetry?.voltage_mv ?? null,
                      "V",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Current
                  </div>
                  <div
                    className="mt-2 font-mono text-[24px] font-bold"
                    data-testid="usb-c-current"
                  >
                    {formatTelemetryValue(
                      usbCTelemetry?.current_ma ?? null,
                      "A",
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Power
                  </div>
                  <div
                    className="mt-2 font-mono text-[24px] font-bold"
                    data-testid="usb-c-power"
                  >
                    {formatTelemetryValue(usbCTelemetry?.power_mw ?? null, "W")}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  className={`flex h-10 items-center justify-center rounded-[10px] text-[12px] font-bold sm:w-[132px] ${
                    usbCPowerActionDisabled
                      ? "bg-[var(--btn-disabled-fill)] text-[var(--btn-disabled-text)]"
                      : "bg-[var(--primary)] text-[var(--primary-text)]"
                  }`}
                  data-testid="runtime-output-toggle"
                  disabled={usbCPowerActionDisabled}
                  onClick={() =>
                    void toggleRuntime("output", !runtimeOutputEnabled)
                  }
                  type="button"
                >
                  Power
                </button>
                <button
                  className={`flex h-10 items-center justify-center rounded-[10px] border border-[var(--border)] text-[12px] font-bold sm:w-[140px] ${
                    usbCPowerActionDisabled
                      ? "bg-[var(--btn-disabled-fill-soft)] text-[var(--btn-disabled-text)]"
                      : "bg-transparent text-[var(--text)]"
                  }`}
                  disabled={usbCPowerActionDisabled}
                  onClick={() => void replugUsbC()}
                  type="button"
                >
                  Replug
                </button>
              </div>
            </section>

            <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-4">
                <div className="text-[14px] font-semibold">
                  TPS light-load mode
                </div>
                <InlineHelpPopover
                  lines={[
                    "PFM follows the board default.",
                    "FPWM forces TPS55288 PWM at light load and is saved with the same power config.",
                  ]}
                  title="TPS light-load mode"
                />
              </div>
              <div className="mt-3 inline-flex h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-1">
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold ${form.light_load_mode === "pfm" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setLightLoadMode("pfm")}
                  type="button"
                >
                  PFM
                </button>
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold ${form.light_load_mode === "fpwm" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setLightLoadMode("fpwm")}
                  type="button"
                >
                  FPWM
                </button>
              </div>
            </section>
          </aside>
        </div>

        <DevicePowerPanelIdleBiasSection
          busy={busy}
          clearIdleBiasCalibration={(owner) => clearIdleBiasCalibration(owner)}
          initialIdleBias={idleBiasSnapshot}
          loadIdleBias={loadIdleBias}
          lockedByOtherHost={lockedByOtherHost}
          onBusyChange={setIdleBiasBusy}
          onRunningChange={setIdleBiasRunning}
          owner={ownerRef.current}
          runIdleBiasCalibration={(owner) => runIdleBiasCalibration(owner)}
          setIdleBiasCorrection={(enabled, owner) =>
            setIdleBiasCorrection(enabled, owner)
          }
        />
      </div>
    </section>
  );
}
