import { useCallback, useEffect, useRef, useState } from "react";

import { getStablePowerLockOwner } from "../../app/device-runtime-support";
import type {
  IdleBiasResponse,
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
  usbCTelemetry: PortTelemetry | null;
  usbCState: PortState | null;
  usbCPending: boolean;
  replugUsbC: () => Promise<void>;
};

type FormState = PowerConfigInput;
type NegotiationChannel = "cc" | "dpdm";

type ProtocolToggle = {
  label: string;
  negotiation: NegotiationChannel;
  checked: boolean;
  onChange: (value: boolean) => void;
};

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
    ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
    : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]";
}

function negotiationBadgeLabel(channel: NegotiationChannel): string {
  return channel === "cc" ? "CC" : "DPDM";
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
  const [idleBiasBusy, setIdleBiasBusy] = useState(false);
  const [idleBiasRunning, setIdleBiasRunning] = useState(false);
  const lockedRef = useRef(false);
  const loadPowerConfigRef = useRef(loadPowerConfig);
  const loadIdleBiasRef = useRef(loadIdleBias);
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
    void loadConfig();
    void loadIdleBiasSnapshot();
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

  const protocolToggles: ProtocolToggle[] = [
    {
      label: "PD",
      negotiation: "cc",
      checked: form.capability.protocols.pd,
      onChange: (value: boolean) => setProtocol("pd", value),
    },
    {
      label: "PPS",
      negotiation: "cc",
      checked: form.capability.pd.pps,
      onChange: setPps,
    },
    {
      label: "QC2",
      negotiation: "dpdm",
      checked: form.capability.protocols.qc20,
      onChange: (value: boolean) => setProtocol("qc20", value),
    },
    {
      label: "QC3",
      negotiation: "dpdm",
      checked: form.capability.protocols.qc30,
      onChange: (value: boolean) => setProtocol("qc30", value),
    },
    {
      label: "FCP",
      negotiation: "dpdm",
      checked: form.capability.protocols.fcp,
      onChange: (value: boolean) => setProtocol("fcp", value),
    },
    {
      label: "AFC",
      negotiation: "dpdm",
      checked: form.capability.protocols.afc,
      onChange: (value: boolean) => setProtocol("afc", value),
    },
    {
      label: "SCP",
      negotiation: "dpdm",
      checked: form.capability.protocols.scp,
      onChange: (value: boolean) => setProtocol("scp", value),
    },
    {
      label: "PE2",
      negotiation: "dpdm",
      checked: form.capability.protocols.pe20,
      onChange: (value: boolean) => setProtocol("pe20", value),
    },
    {
      label: "BC1.2",
      negotiation: "dpdm",
      checked: form.capability.protocols.bc12,
      onChange: (value: boolean) => setProtocol("bc12", value),
    },
    {
      label: "SFCP",
      negotiation: "dpdm",
      checked: form.capability.protocols.sfcp,
      onChange: (value: boolean) => setProtocol("sfcp", value),
    },
  ];

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
            className={`inline-flex h-7 items-center rounded-full px-3 font-semibold ${lockedByOtherHost ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"}`}
          >
            {lockedByOtherHost ? "Host lock active" : "Host lock idle"}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-full px-3 font-semibold ${idleBiasRunning ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"}`}
          >
            {idleBiasRunning ? "Calibration running" : "Calibration idle"}
          </span>
        </div>
      </header>

      <div className="grid gap-5">
        <section className="grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
          <div className="protocol-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {protocolToggles.map((protocol) => (
              <label
                className={`protocol-card flex min-h-[64px] items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-[13px] transition ${protocol.checked ? "border-[var(--badge-success-text)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                key={protocol.label}
              >
                <span className="grid min-w-0 gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">
                      {protocol.label}
                    </span>
                    <span
                      className="protocol-negotiation-badge h-5 shrink-0 items-center rounded-full border border-current/15 bg-[var(--panel)] px-2 text-[10px] font-bold uppercase tracking-[0.02em]"
                      data-testid={`${protocol.label}-negotiation-badge`}
                    >
                      {negotiationBadgeLabel(protocol.negotiation)}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold uppercase">
                    {protocol.checked ? "On" : "Off"}
                  </span>
                </span>
                <input
                  checked={protocol.checked}
                  className="peer sr-only"
                  disabled={powerControlsDisabled}
                  onChange={(event) => protocol.onChange(event.target.checked)}
                  type="checkbox"
                />
                <span
                  aria-hidden="true"
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)] ${protocol.checked ? "border-[var(--badge-success-text)] bg-[var(--badge-success-text)]" : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)]"}`}
                >
                  <span
                    className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[var(--panel)] shadow-sm transition ${protocol.checked ? "left-[24px]" : "left-[3px]"}`}
                  />
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <section className="grid gap-4 rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Output mode</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  Manual TPS output is only for advanced bench work. USB-C path
                  policy stays explicit.
                </div>
              </div>
              <div className="inline-flex h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-1 sm:w-auto">
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
                  <span className="rounded-full bg-[var(--badge-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--badge-warning-text)]">
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
                    className={`flex min-h-[88px] flex-col items-start justify-between rounded-[8px] border px-3 py-3 text-left ${form.manual.usb_c_path_mode === value ? "border-[var(--primary)] bg-[var(--panel)]" : "border-[var(--border)] bg-[var(--panel)]"} ${powerControlsDisabled || form.tps_mode !== "manual" ? "opacity-60" : ""}`}
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
                <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
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
                <div className="text-[12px] text-[var(--badge-success-text)]">
                  {status}
                </div>
              ) : null}
              {error ? (
                <div className="text-[12px] text-[var(--badge-error-text)]">
                  {error}
                </div>
              ) : null}
            </div>
          </section>

          <aside className="grid gap-5">
            <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="text-[14px] font-semibold">USB-C</div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="flex h-6 items-center justify-center rounded-full bg-[var(--btn-disabled-fill-soft)] px-3 text-[12px] font-semibold text-[var(--muted)]">
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
                      ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
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
                      ? "bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
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

            <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
              <div className="flex items-center gap-2">
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
