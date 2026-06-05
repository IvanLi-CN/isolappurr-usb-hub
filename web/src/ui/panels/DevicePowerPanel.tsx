import { useEffect, useRef, useState } from "react";

import type {
  PowerConfigInput,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";

const HEARTBEAT_MS = 8_000;

type DevicePowerPanelProps = {
  deviceName: string;
  transportLabel: string;
  localAdvancedLocked: boolean;
  loadPowerConfig: () => Promise<Result<PowerConfigResponse>>;
  savePowerConfig: (
    input: PowerConfigInput,
    owner: number,
  ) => Promise<Result<PowerConfigResponse>>;
  restorePowerDefaults: (owner: number) => Promise<Result<PowerConfigResponse>>;
  setPowerLock: (
    owner: number,
    acquire: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
};

type FormState = PowerConfigInput;

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

function createLockOwner(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

export function DevicePowerPanel({
  deviceName,
  transportLabel,
  localAdvancedLocked,
  loadPowerConfig,
  savePowerConfig,
  restorePowerDefaults,
  setPowerLock,
}: DevicePowerPanelProps) {
  const [config, setConfig] = useState<PowerConfigResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lockedRef = useRef(false);
  const loadPowerConfigRef = useRef(loadPowerConfig);
  const setPowerLockRef = useRef(setPowerLock);
  const ownerRef = useRef(createLockOwner());

  useEffect(() => {
    loadPowerConfigRef.current = loadPowerConfig;
  }, [loadPowerConfig]);

  useEffect(() => {
    setPowerLockRef.current = setPowerLock;
  }, [setPowerLock]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await loadPowerConfigRef.current();
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setConfig(res.value);
        setForm(cloneConfig(res.value));
        setError(null);
        setDirty(false);
      } else {
        setError(res.error.message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!lockedRef.current) {
        return;
      }
      const res = await setPowerLockRef.current(ownerRef.current, true);
      if (!cancelled && !res.ok) {
        setError(res.error.message);
      } else if (!cancelled && res.ok) {
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
  const advancedDisabled = localAdvancedLocked || lockedByOtherHost;
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
          Loading power settings…
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

  const protocolToggles = [
    {
      label: "PD",
      checked: form.capability.protocols.pd,
      onChange: (value: boolean) => setProtocol("pd", value),
    },
    {
      label: "PPS",
      checked: form.capability.pd.pps,
      onChange: setPps,
    },
    {
      label: "QC2",
      checked: form.capability.protocols.qc20,
      onChange: (value: boolean) => setProtocol("qc20", value),
    },
    {
      label: "QC3",
      checked: form.capability.protocols.qc30,
      onChange: (value: boolean) => setProtocol("qc30", value),
    },
    {
      label: "FCP",
      checked: form.capability.protocols.fcp,
      onChange: (value: boolean) => setProtocol("fcp", value),
    },
    {
      label: "AFC",
      checked: form.capability.protocols.afc,
      onChange: (value: boolean) => setProtocol("afc", value),
    },
    {
      label: "SCP",
      checked: form.capability.protocols.scp,
      onChange: (value: boolean) => setProtocol("scp", value),
    },
    {
      label: "PE2",
      checked: form.capability.protocols.pe20,
      onChange: (value: boolean) => setProtocol("pe20", value),
    },
    {
      label: "BC1.2",
      checked: form.capability.protocols.bc12,
      onChange: (value: boolean) => setProtocol("bc12", value),
    },
    {
      label: "SFCP",
      checked: form.capability.protocols.sfcp,
      onChange: (value: boolean) => setProtocol("sfcp", value),
    },
  ];

  const submit = async () => {
    setBusy(true);
    setStatus("Saving and applying power configuration…");
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
    setStatus("Restoring defaults…");
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
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.9fr]">
        <div className="flex flex-col gap-5">
          <section className="grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Safe profile</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  Source capability stays on SW2303. Changes save to EEPROM and
                  apply immediately.
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-[12px] text-[var(--muted)]">Power cap</div>
                <div className="text-[20px] font-semibold">
                  {form.capability.power_watts} W
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {protocolToggles.map((protocol) => (
                <label
                  className={`flex min-h-[58px] items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-[13px] transition ${protocol.checked ? "border-[var(--badge-success-text)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]"}`}
                  key={protocol.label}
                >
                  <span className="grid gap-0.5">
                    <span className="font-semibold">{protocol.label}</span>
                    <span className="text-[11px] font-semibold uppercase">
                      {protocol.checked ? "On" : "Off"}
                    </span>
                  </span>
                  <input
                    checked={protocol.checked}
                    className="toggle toggle-sm"
                    onChange={(event) =>
                      protocol.onChange(event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </section>

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
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "auto_follow" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"}`}
                  onClick={() => setTpsMode("auto_follow")}
                  type="button"
                >
                  Auto follow
                </button>
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "manual" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"}`}
                  onClick={() => setTpsMode("manual")}
                  type="button"
                >
                  Manual TPS
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-[13px]">
                <span className="font-medium text-[var(--muted)]">Voltage</span>
                <input
                  className="h-11 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 text-[15px]"
                  disabled={advancedDisabled || form.tps_mode !== "manual"}
                  max={21000}
                  min={3000}
                  onChange={(event) =>
                    setManualNumber("voltage_mv", Number(event.target.value))
                  }
                  step={20}
                  type="number"
                  value={form.manual.voltage_mv}
                />
              </label>
              <label className="grid gap-2 text-[13px]">
                <span className="font-medium text-[var(--muted)]">
                  Current limit
                </span>
                <input
                  className="h-11 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 text-[15px]"
                  disabled={advancedDisabled || form.tps_mode !== "manual"}
                  max={6350}
                  min={1000}
                  onChange={(event) =>
                    setManualNumber(
                      "current_limit_ma",
                      Number(event.target.value),
                    )
                  }
                  step={50}
                  type="number"
                  value={form.manual.current_limit_ma}
                />
              </label>
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
                    className={`flex min-h-[88px] flex-col items-start justify-between rounded-[8px] border px-3 py-3 text-left ${form.manual.usb_c_path_mode === value ? "border-[var(--primary)] bg-[var(--panel)]" : "border-[var(--border)] bg-[var(--panel)]"} ${advancedDisabled || form.tps_mode !== "manual" ? "opacity-60" : ""}`}
                    disabled={advancedDisabled || form.tps_mode !== "manual"}
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
        </div>

        <aside className="grid gap-5">
          <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
            <div className="text-[14px] font-semibold">Advanced guardrails</div>
            <div className="mt-3 grid gap-2 text-[12px] leading-5 text-[var(--muted)]">
              <div>Manual TPS range: 3 V to 21 V.</div>
              <div>
                Current is capped by TPS and a hard 100 W product ceiling.
              </div>
              <div>Default manual output targets the banana / 2 mm path.</div>
              <div>
                {advancedDisabled
                  ? "Advanced controls are locked while a host settings session is active."
                  : "Advanced controls are writable from this surface."}
              </div>
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
            <div className="text-[14px] font-semibold">Actions</div>
            <div className="mt-4 flex flex-col gap-3">
              <button
                className="flex h-11 items-center justify-center rounded-[8px] bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--primary-text)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !dirty}
                onClick={() => void submit()}
                type="button"
              >
                Save and apply
              </button>
              <button
                className="flex h-11 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
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
    </section>
  );
}
