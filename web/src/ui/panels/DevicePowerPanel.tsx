import { useCallback, useEffect, useRef, useState } from "react";

import { getStablePowerLockOwner } from "../../app/device-runtime-support";
import type {
  IdleBiasResponse,
  PowerConfigInput,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";

const HEARTBEAT_MS = 8_000;
const IDLE_BIAS_POLL_MS = 900;

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
  setIdleBiasCorrection: (
    enabled: boolean,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  runIdleBiasCalibration: (owner: number) => Promise<Result<IdleBiasResponse>>;
  clearIdleBiasCalibration: (
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
};

type FormState = PowerConfigInput;
type NegotiationChannel = "cc" | "dpdm";
type IdleBiasAction = "run" | "clear" | "enable" | "disable";

type ProtocolToggle = {
  label: string;
  negotiation: NegotiationChannel;
  checked: boolean;
  onChange: (value: boolean) => void;
};

type IdleBiasConfirmState = {
  action: IdleBiasAction;
  title: string;
  description: string;
  confirmLabel: string;
};

type IdleBiasTableRow = {
  index: number;
  offsetMa: number;
  voltageMv: number;
};

type SummaryCardProps = {
  title: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning" | "error";
};

function cloneConfig(config: PowerConfigResponse): FormState {
  return {
    hardware: "sw2303",
    tps_mode: config.tps_mode,
    capability: config.capability,
    manual: config.manual,
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
  return raw.trim().toLowerCase().replaceAll("mu", "u").replaceAll("µ", "u");
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

function formatCompactVoltage(mv: number | null | undefined): string {
  if (mv === null || mv === undefined) {
    return "--";
  }
  const volts = mv / 1000;
  return `${Number.isInteger(volts) ? volts.toFixed(0) : volts.toFixed(1)} V`;
}

function summarizeIdleBiasDataset(idleBias: IdleBiasResponse | null): {
  value: string;
  detail: string;
  tone: SummaryCardProps["tone"];
} {
  if (!idleBias) {
    return {
      value: "Loading",
      detail: "Reading the saved idle-bias dataset from the hub.",
      tone: "default",
    };
  }
  const dataset = idleBias.dataset;
  const range = `${formatCompactVoltage(dataset.min_voltage_mv)} to ${formatCompactVoltage(dataset.max_voltage_mv)}`;
  const detail = `${range} sweep in ${formatCompactVoltage(dataset.step_mv)} steps across ${dataset.point_count} points.`;
  if (dataset.status === "valid") {
    return {
      value: "Ready",
      detail,
      tone: "success",
    };
  }
  return {
    value: "Missing",
    detail,
    tone: "warning",
  };
}

function summarizeIdleBiasCorrection(idleBias: IdleBiasResponse | null): {
  value: string;
  detail: string;
  tone: SummaryCardProps["tone"];
} {
  if (!idleBias) {
    return {
      value: "Loading",
      detail: "Waiting for the current correction state.",
      tone: "default",
    };
  }
  if (idleBias.dataset.status !== "valid") {
    return {
      value: "Unavailable",
      detail:
        "Run USB-C empty-load calibration before corrected telemetry can be applied.",
      tone: "warning",
    };
  }
  if (idleBias.correction_enabled) {
    const applied =
      idleBias.current_applied_offset_ma === null
        ? "Corrected USB-C telemetry is active."
        : `Subtracting ${idleBias.current_applied_offset_ma} mA from the live USB-C current reading.`;
    return {
      value: "Applied",
      detail: applied,
      tone: "success",
    };
  }
  return {
    value: "Off",
    detail:
      "Dataset is saved, but the main USB-C telemetry is currently using the raw INA226 reading.",
    tone: "default",
  };
}

function summarizeIdleBiasRun(idleBias: IdleBiasResponse | null): {
  value: string;
  detail: string;
  tone: SummaryCardProps["tone"];
} {
  if (!idleBias) {
    return {
      value: "Loading",
      detail: "Waiting for the calibration job state.",
      tone: "default",
    };
  }
  const run = idleBias.run;
  if (run.state === "running") {
    const target =
      run.target_voltage_mv === null
        ? ""
        : ` at ${formatCompactVoltage(run.target_voltage_mv)}`;
    return {
      value: `${run.completed_points}/${run.point_count}`,
      detail: `Sweeping USB-C empty-load points${target}.`,
      tone: "warning",
    };
  }
  if (run.state === "failed") {
    return {
      value: "Failed",
      detail:
        run.error?.message ??
        "Calibration stopped before the dataset could be saved.",
      tone: "error",
    };
  }
  return {
    value: "Idle",
    detail:
      idleBias.dataset.status === "valid"
        ? "No calibration job is running. The saved dataset remains available."
        : "No calibration job is running. The hub still needs a saved dataset.",
    tone: "default",
  };
}

function confirmCopyForIdleBiasAction(
  action: IdleBiasAction,
): IdleBiasConfirmState {
  switch (action) {
    case "run":
      return {
        action,
        title: "Run USB-C idle-bias calibration?",
        description:
          "Disconnect every USB-C device first. The hub will sweep 3.0 V to 21.0 V across 37 empty-load points, record SW2303 idle current into EEPROM, and then restore the active power configuration.",
        confirmLabel: "Run calibration",
      };
    case "clear":
      return {
        action,
        title: "Clear the saved idle-bias dataset?",
        description:
          "This removes the EEPROM calibration table and forces idle-bias correction off until a new empty-load sweep is completed.",
        confirmLabel: "Clear dataset",
      };
    case "enable":
      return {
        action,
        title: "Apply idle-bias correction?",
        description:
          "Corrected USB-C current and power will subtract the saved SW2303 empty-load offset. Raw INA226 telemetry remains available only in diagnostics.",
        confirmLabel: "Apply correction",
      };
    case "disable":
      return {
        action,
        title: "Disable idle-bias correction?",
        description:
          "The main USB-C telemetry will immediately return to the raw INA226 current and power reading.",
        confirmLabel: "Disable correction",
      };
  }
}

function buildIdleBiasTableRows(
  idleBias: IdleBiasResponse | null,
): IdleBiasTableRow[] {
  const offsets = idleBias?.dataset.offsets_ma;
  if (!offsets || idleBias?.dataset.status !== "valid") {
    return [];
  }
  return offsets.map((offsetMa, index) => ({
    index,
    offsetMa,
    voltageMv:
      idleBias.dataset.min_voltage_mv + idleBias.dataset.step_mv * index,
  }));
}

function SummaryCard({
  title,
  value,
  detail,
  tone = "default",
}: SummaryCardProps) {
  const toneClass =
    tone === "success"
      ? "border-[var(--badge-success-text)]/20 bg-[var(--badge-success-bg)]"
      : tone === "warning"
        ? "border-[var(--badge-warning-text)]/20 bg-[var(--badge-warning-bg)]"
        : tone === "error"
          ? "border-[var(--badge-error-text)]/20 bg-[var(--panel)]"
          : "border-[var(--border)] bg-[var(--panel)]";

  return (
    <div className={`rounded-[10px] border px-4 py-4 ${toneClass}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]">
        {title}
      </div>
      <div className="mt-2 text-[20px] font-semibold text-[var(--text)]">
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-6 text-[var(--muted)]">
        {detail}
      </div>
    </div>
  );
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
  setIdleBiasCorrection,
  runIdleBiasCalibration,
  clearIdleBiasCalibration,
}: DevicePowerPanelProps) {
  const [config, setConfig] = useState<PowerConfigResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [idleBias, setIdleBias] = useState<IdleBiasResponse | null>(null);
  const [idleBiasStatus, setIdleBiasStatus] = useState<string | null>(null);
  const [idleBiasError, setIdleBiasError] = useState<string | null>(null);
  const [idleBiasBusy, setIdleBiasBusy] = useState(false);
  const [idleBiasConfirm, setIdleBiasConfirm] =
    useState<IdleBiasConfirmState | null>(null);
  const [idleBiasTableExpanded, setIdleBiasTableExpanded] = useState(false);
  const lockedRef = useRef(false);
  const loadPowerConfigRef = useRef(loadPowerConfig);
  const loadIdleBiasRef = useRef(loadIdleBias);
  const setPowerLockRef = useRef(setPowerLock);
  const ownerRef = useRef(getStablePowerLockOwner(deviceKey));

  const applyLoadedConfig = useCallback((nextConfig: PowerConfigResponse) => {
    setConfig(nextConfig);
    setForm(cloneConfig(nextConfig));
    setError(null);
    setDirty(false);
  }, []);

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
    let cancelled = false;
    const load = async () => {
      const [configRes, idleBiasRes] = await Promise.all([
        loadPowerConfigRef.current(),
        loadIdleBiasRef.current(),
      ]);
      if (cancelled) {
        return;
      }
      if (configRes.ok) {
        applyLoadedConfig(configRes.value);
      } else {
        setError(configRes.error.message);
      }
      if (idleBiasRes.ok) {
        setIdleBias(idleBiasRes.value);
        setIdleBiasError(null);
      } else {
        setIdleBiasError(idleBiasRes.error.message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedConfig]);

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
      applyLoadedConfig(configRes.value);
    };
    void retry();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedConfig, form, transportLabel]);

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

  useEffect(() => {
    if (idleBias?.run.state !== "running") {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const res = await loadIdleBiasRef.current();
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setIdleBiasError(res.error.message);
        return;
      }
      setIdleBias(res.value);
      setIdleBiasError(null);
      if (res.value.run.state === "idle") {
        setIdleBiasStatus("Calibration completed and saved to EEPROM.");
      } else if (res.value.run.state === "failed") {
        setIdleBiasStatus(null);
        setIdleBiasError(
          res.value.run.error?.message ??
            "Calibration failed before completion.",
        );
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), IDLE_BIAS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [idleBias?.run.state]);

  const lockedByOtherHost =
    config?.lock !== null &&
    config?.lock !== undefined &&
    config.lock.owner !== ownerRef.current;
  const idleBiasRunning = idleBias?.run.state === "running";
  const advancedDisabled =
    localAdvancedLocked || lockedByOtherHost || idleBiasRunning;
  const powerControlsDisabled = advancedDisabled || busy || idleBiasBusy;
  const idleBiasControlsDisabled =
    lockedByOtherHost || busy || idleBiasBusy || idleBiasRunning;

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

  const setPathMode = (mode: FormState["manual"]["usb_c_path_mode"]) => {
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

  const requestIdleBiasAction = (action: IdleBiasAction) => {
    setIdleBiasConfirm(confirmCopyForIdleBiasAction(action));
  };

  const confirmIdleBiasAction = async () => {
    if (!idleBiasConfirm) {
      return;
    }
    setIdleBiasBusy(true);
    setIdleBiasError(null);
    setIdleBiasStatus(null);

    let result: Result<IdleBiasResponse>;
    switch (idleBiasConfirm.action) {
      case "run":
        setIdleBiasStatus("Starting USB-C idle-bias calibration...");
        result = await runIdleBiasCalibration(ownerRef.current);
        break;
      case "clear":
        setIdleBiasStatus("Clearing saved idle-bias dataset...");
        result = await clearIdleBiasCalibration(ownerRef.current);
        break;
      case "enable":
        setIdleBiasStatus("Applying idle-bias correction...");
        result = await setIdleBiasCorrection(true, ownerRef.current);
        break;
      case "disable":
        setIdleBiasStatus("Disabling idle-bias correction...");
        result = await setIdleBiasCorrection(false, ownerRef.current);
        break;
    }

    setIdleBiasBusy(false);
    setIdleBiasConfirm(null);

    if (!result.ok) {
      setIdleBiasStatus(null);
      setIdleBiasError(result.error.message);
      return;
    }

    setIdleBias(result.value);
    setIdleBiasError(null);
    if (idleBiasConfirm.action === "run") {
      setIdleBiasStatus(
        result.value.run.state === "running"
          ? "Calibration running. Keep USB-C disconnected until the sweep finishes."
          : "Calibration completed and saved to EEPROM.",
      );
      return;
    }
    if (idleBiasConfirm.action === "clear") {
      setIdleBiasStatus("Idle-bias dataset cleared and correction forced off.");
      return;
    }
    setIdleBiasStatus(
      result.value.correction_enabled
        ? "Corrected USB-C telemetry is now active."
        : "USB-C telemetry returned to the raw INA226 reading.",
    );
  };

  const datasetSummary = summarizeIdleBiasDataset(idleBias);
  const correctionSummary = summarizeIdleBiasCorrection(idleBias);
  const runSummary = summarizeIdleBiasRun(idleBias);
  const correctionButtonLabel =
    idleBias?.correction_enabled === true
      ? "Disable correction"
      : "Apply correction";
  const canToggleCorrection =
    idleBias?.dataset.status === "valid" || idleBias?.correction_enabled;
  const idleBiasTableRows = buildIdleBiasTableRows(idleBias);
  const canShowIdleBiasTable = idleBiasTableRows.length > 0;

  return (
    <>
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
                    onChange={(event) =>
                      protocol.onChange(event.target.checked)
                    }
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
                    Manual TPS output is only for advanced bench work. USB-C
                    path policy stays explicit.
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
                  onChange={(value) =>
                    setManualNumber("current_limit_ma", value)
                  }
                  parseValue={parseCurrentInput}
                  step={50}
                  value={form.manual.current_limit_ma}
                />
              </div>

              <div className="grid gap-2">
                <div className="text-[13px] font-medium text-[var(--muted)]">
                  USB-C path
                </div>
                <div className="grid gap-2 lg:grid-cols-3">
                  {[
                    [
                      "default",
                      "Default",
                      "Disconnect only while manual voltage exceeds negotiated SW2303 request.",
                    ],
                    [
                      "disconnect",
                      "Disconnect",
                      "Force SW2303 path off regardless of negotiated voltage.",
                    ],
                    [
                      "force",
                      "Force",
                      "Keep USB-C VBUS connected to TPS VOUT unconditionally.",
                    ],
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
              </div>
            </section>

            <aside className="grid gap-5">
              <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
                <div className="text-[14px] font-semibold">Actions</div>
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    className="flex h-11 items-center justify-center rounded-[8px] bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--primary-text)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={powerControlsDisabled || !dirty}
                    onClick={() => void submit()}
                    type="button"
                  >
                    Save and apply
                  </button>
                  <button
                    className="flex h-11 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={powerControlsDisabled}
                    onClick={() => void restore()}
                    type="button"
                  >
                    Restore defaults
                  </button>
                </div>
                {status ? (
                  <div className="mt-3 text-[12px] text-[var(--badge-success-text)]">
                    {status}
                  </div>
                ) : null}
                {error ? (
                  <div className="mt-3 text-[12px] text-[var(--badge-error-text)]">
                    {error}
                  </div>
                ) : null}
              </section>
            </aside>
          </div>

          <section className="grid gap-4 rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-[760px]">
                <div className="text-[14px] font-semibold">
                  USB-C Idle Bias Calibration
                </div>
                <div className="mt-1 text-[12px] leading-6 text-[var(--muted)]">
                  Measure SW2303 empty-load current from 3.0 V to 21.0 V with
                  nothing attached on USB-C, save the 37-point dataset to
                  EEPROM, and optionally subtract it from the main USB-C INA226
                  reading.
                </div>
              </div>
              <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3 text-[12px] leading-6 text-[var(--muted)]">
                <div className="font-semibold text-[var(--text)]">
                  Safety reminder
                </div>
                <div>Disconnect every USB-C device before calibration.</div>
                <div>Existing power settings are restored after the sweep.</div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <SummaryCard
                title="Dataset"
                value={datasetSummary.value}
                detail={datasetSummary.detail}
                tone={datasetSummary.tone}
              />
              <SummaryCard
                title="Correction"
                value={correctionSummary.value}
                detail={correctionSummary.detail}
                tone={correctionSummary.tone}
              />
              <SummaryCard
                title="Run state"
                value={runSummary.value}
                detail={runSummary.detail}
                tone={runSummary.tone}
              />
            </div>

            {canShowIdleBiasTable ? (
              <section className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)]">
                <button
                  aria-expanded={idleBiasTableExpanded}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                  onClick={() =>
                    setIdleBiasTableExpanded((current) => !current)
                  }
                  type="button"
                >
                  <span className="grid gap-1">
                    <span className="text-[13px] font-semibold text-[var(--text)]">
                      Calibration dataset table
                    </span>
                    <span className="text-[12px] leading-5 text-[var(--muted)]">
                      Inspect all {idleBiasTableRows.length} saved voltage
                      points and their SW2303 idle-current offsets.
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold text-[var(--muted)]">
                    {idleBiasTableExpanded ? "Hide" : "Show"}
                  </span>
                </button>
                {idleBiasTableExpanded ? (
                  <div className="border-t border-[var(--border)] px-4 py-4">
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-0 text-[12px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-[0.04em] text-[var(--muted)]">
                            <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                              Point
                            </th>
                            <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                              Voltage
                            </th>
                            <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                              Offset
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {idleBiasTableRows.map((row) => (
                            <tr
                              className="text-[var(--text)]"
                              key={`${row.index}-${row.voltageMv}`}
                            >
                              <td className="border-b border-[var(--border)]/70 px-3 py-2 font-semibold">
                                {row.index + 1}
                              </td>
                              <td className="border-b border-[var(--border)]/70 px-3 py-2">
                                {formatCompactVoltage(row.voltageMv)}
                              </td>
                              <td className="border-b border-[var(--border)]/70 px-3 py-2">
                                {row.offsetMa} mA
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {idleBias?.run.state === "running" ? (
              <div className="rounded-[10px] border border-[var(--badge-warning-text)]/25 bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-warning-text)]">
                Calibration progress: {idleBias.run.completed_points}/
                {idleBias.run.point_count}
                {idleBias.run.target_voltage_mv === null
                  ? ""
                  : ` · target ${formatCompactVoltage(idleBias.run.target_voltage_mv)}`}
                . Power configuration edits are disabled until the sweep
                finishes.
              </div>
            ) : null}

            <div className="flex flex-col gap-3 lg:flex-row">
              <button
                className="flex h-11 min-w-[180px] items-center justify-center rounded-[8px] bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--primary-text)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={idleBiasControlsDisabled}
                onClick={() => requestIdleBiasAction("run")}
                type="button"
              >
                Run calibration
              </button>
              <button
                className="flex h-11 min-w-[180px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={idleBiasControlsDisabled || !canToggleCorrection}
                onClick={() =>
                  requestIdleBiasAction(
                    idleBias?.correction_enabled ? "disable" : "enable",
                  )
                }
                type="button"
              >
                {correctionButtonLabel}
              </button>
              <button
                className="flex h-11 min-w-[180px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  idleBiasControlsDisabled ||
                  idleBias?.dataset.status !== "valid"
                }
                onClick={() => requestIdleBiasAction("clear")}
                type="button"
              >
                Clear dataset
              </button>
            </div>

            {lockedByOtherHost ? (
              <div className="rounded-[10px] border border-[var(--badge-warning-text)]/25 bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-warning-text)]">
                Another host owns the power lock, so idle-bias actions are
                blocked until that lock expires.
              </div>
            ) : null}

            {idleBiasStatus ? (
              <div className="rounded-[10px] border border-[var(--badge-success-text)]/20 bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-success-text)]">
                {idleBiasStatus}
              </div>
            ) : null}

            {idleBiasError ? (
              <div
                className="rounded-[10px] border border-[var(--badge-error-text)]/20 bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-error-text)]"
                role="alert"
              >
                {idleBiasError}
              </div>
            ) : null}
          </section>
        </div>
      </section>

      {idleBiasConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="presentation"
        >
          <div
            className="w-full max-w-[480px] rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="idle-bias-confirm-title"
            aria-describedby="idle-bias-confirm-description"
          >
            <div
              id="idle-bias-confirm-title"
              className="text-[15px] font-bold text-[var(--text)]"
            >
              {idleBiasConfirm.title}
            </div>
            <div
              id="idle-bias-confirm-description"
              className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]"
            >
              {idleBiasConfirm.description}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="btn btn-outline btn-sm min-h-10 justify-center"
                type="button"
                disabled={idleBiasBusy}
                onClick={() => setIdleBiasConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm min-h-10 justify-center"
                type="button"
                disabled={idleBiasBusy}
                onClick={() => void confirmIdleBiasAction()}
              >
                {idleBiasBusy ? "Applying..." : idleBiasConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
