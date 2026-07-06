import { Fragment, useEffect, useId, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { IdleBiasResponse, Result } from "../../domain/deviceApi";

const IDLE_BIAS_POLL_MS = 900;

type IdleBiasAction = "run" | "clear" | "enable" | "disable";
type IdleBiasViewMode = "chart" | "table";

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

type IdleBiasTableColumn = {
  index: number;
  rows: IdleBiasTableRow[];
};

type SummaryCardProps = {
  title: string;
  value: string;
  detail: string;
  tone?: "default" | "success" | "warning" | "error";
};

type DevicePowerPanelIdleBiasSectionProps = {
  busy: boolean;
  clearIdleBiasCalibration: (
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  initialIdleBias: IdleBiasResponse | null;
  loadIdleBias: () => Promise<Result<IdleBiasResponse>>;
  lockedByOtherHost: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRunningChange?: (running: boolean) => void;
  owner: number;
  runIdleBiasCalibration: (owner: number) => Promise<Result<IdleBiasResponse>>;
  setIdleBiasCorrection: (
    enabled: boolean,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
};

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

function chunkIdleBiasTableRows(
  rows: IdleBiasTableRow[],
  columns: number,
): IdleBiasTableColumn[] {
  if (rows.length === 0) {
    return [];
  }
  const safeColumns = Math.max(1, columns);
  const rowsPerColumn = Math.ceil(rows.length / safeColumns);
  return Array.from({ length: safeColumns }, (_value, index) => {
    const start = index * rowsPerColumn;
    return {
      index,
      rows: rows.slice(start, start + rowsPerColumn),
    };
  }).filter((column) => column.rows.length > 0);
}

function buildIdleBiasTableRowKeys(columns: IdleBiasTableColumn[]): string[] {
  const rowCount = Math.max(0, ...columns.map((column) => column.rows.length));
  return Array.from({ length: rowCount }, (_value, rowIndex) =>
    columns
      .map((column) => {
        const row = column.rows[rowIndex];
        return row
          ? `${column.index}:${row.index}:${row.voltageMv}`
          : `${column.index}:empty`;
      })
      .join("|"),
  );
}

function offsetTickFormatter(value: number): string {
  return `${value} mA`;
}

function IdleBiasTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value?: number }>;
}) {
  if (
    !active ||
    !payload ||
    payload.length === 0 ||
    payload[0]?.value == null
  ) {
    return null;
  }
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12px] shadow-sm">
      <div className="font-semibold text-[var(--text)]">{label}</div>
      <div className="mt-1 text-[var(--muted)]">
        Offset {payload[0].value} mA
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  tone = "default",
}: SummaryCardProps) {
  const toneClass =
    tone === "success"
      ? "border-[var(--protocol-enabled-ring)] bg-[var(--protocol-enabled-bg)]"
      : tone === "warning"
        ? "border-[var(--surface-warning-ring)] bg-[var(--surface-warning-bg)]"
        : tone === "error"
          ? "border-[var(--surface-error-ring)] bg-[var(--surface-error-bg)]"
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

export function DevicePowerPanelIdleBiasSection({
  busy,
  clearIdleBiasCalibration,
  initialIdleBias,
  loadIdleBias,
  lockedByOtherHost,
  onBusyChange,
  onRunningChange,
  owner,
  runIdleBiasCalibration,
  setIdleBiasCorrection,
}: DevicePowerPanelIdleBiasSectionProps) {
  const idleBiasViewLabelId = useId();
  const [idleBias, setIdleBias] = useState<IdleBiasResponse | null>(
    initialIdleBias,
  );
  const [idleBiasStatus, setIdleBiasStatus] = useState<string | null>(null);
  const [idleBiasError, setIdleBiasError] = useState<string | null>(null);
  const [idleBiasBusy, setIdleBiasBusy] = useState(false);
  const [idleBiasConfirm, setIdleBiasConfirm] =
    useState<IdleBiasConfirmState | null>(null);
  const [idleBiasTableExpanded, setIdleBiasTableExpanded] = useState(false);
  const [idleBiasViewMode, setIdleBiasViewMode] =
    useState<IdleBiasViewMode>("chart");
  const loadIdleBiasRef = useRef(loadIdleBias);

  useEffect(() => {
    loadIdleBiasRef.current = loadIdleBias;
  }, [loadIdleBias]);

  useEffect(() => {
    setIdleBias(initialIdleBias);
  }, [initialIdleBias]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const idleBiasRes = await loadIdleBiasRef.current();
      if (cancelled) {
        return;
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

  useEffect(() => {
    onBusyChange?.(idleBiasBusy);
  }, [idleBiasBusy, onBusyChange]);

  useEffect(() => {
    onRunningChange?.(idleBias?.run.state === "running");
  }, [idleBias?.run.state, onRunningChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
      onRunningChange?.(false);
    };
  }, [onBusyChange, onRunningChange]);

  const idleBiasRunning = idleBias?.run.state === "running";
  const idleBiasControlsDisabled =
    lockedByOtherHost || busy || idleBiasBusy || idleBiasRunning;
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
  const idleBiasTableColumns = chunkIdleBiasTableRows(idleBiasTableRows, 3);
  const idleBiasTableRowKeys = buildIdleBiasTableRowKeys(idleBiasTableColumns);

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
        result = await runIdleBiasCalibration(owner);
        break;
      case "clear":
        setIdleBiasStatus("Clearing saved idle-bias dataset...");
        result = await clearIdleBiasCalibration(owner);
        break;
      case "enable":
        setIdleBiasStatus("Applying idle-bias correction...");
        result = await setIdleBiasCorrection(true, owner);
        break;
      case "disable":
        setIdleBiasStatus("Disabling idle-bias correction...");
        result = await setIdleBiasCorrection(false, owner);
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

  return (
    <>
      <section className="grid gap-4 rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-[760px]">
            <div className="text-[14px] font-semibold">
              USB-C Idle Bias Calibration
            </div>
            <div className="mt-1 text-[12px] leading-6 text-[var(--muted)]">
              Measure SW2303 empty-load current from 3.0 V to 21.0 V with
              nothing attached on USB-C, save the 37-point dataset to EEPROM,
              and optionally subtract it from the main USB-C INA226 reading.
            </div>
          </div>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel-3)] px-3 py-3 text-[12px] leading-6 text-[var(--muted)]">
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
          <section className="rounded-[10px] border border-[var(--border)] bg-[var(--panel-3)]">
            <button
              aria-expanded={idleBiasTableExpanded}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
              onClick={() => setIdleBiasTableExpanded((current) => !current)}
              type="button"
            >
              <span className="grid gap-1">
                <span className="text-[13px] font-semibold text-[var(--text)]">
                  Calibration dataset table
                </span>
                <span className="text-[12px] leading-5 text-[var(--muted)]">
                  Inspect all {idleBiasTableRows.length} saved voltage points
                  and their SW2303 idle-current offsets.
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-[var(--muted)]">
                {idleBiasTableExpanded ? "Hide" : "Show"}
              </span>
            </button>
            {idleBiasTableExpanded ? (
              <div className="border-t border-[var(--border)] px-4 py-4">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="max-w-[65ch] text-[12px] leading-6 text-[var(--muted)]">
                      Chart is the default review surface for voltage to
                      idle-current drift. Switch to the table when you need
                      exact point values.
                    </div>
                    <div
                      aria-labelledby={idleBiasViewLabelId}
                      className="inline-flex h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-1 md:w-auto"
                      role="tablist"
                    >
                      <span className="sr-only" id={idleBiasViewLabelId}>
                        Idle-bias dataset view
                      </span>
                      <button
                        aria-selected={idleBiasViewMode === "chart"}
                        className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold md:min-w-[96px] ${idleBiasViewMode === "chart" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"}`}
                        onClick={() => setIdleBiasViewMode("chart")}
                        role="tab"
                        type="button"
                      >
                        Chart
                      </button>
                      <button
                        aria-selected={idleBiasViewMode === "table"}
                        className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold md:min-w-[96px] ${idleBiasViewMode === "table" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"}`}
                        onClick={() => setIdleBiasViewMode("table")}
                        role="tab"
                        type="button"
                      >
                        Table
                      </button>
                    </div>
                  </div>

                  {idleBiasViewMode === "chart" ? (
                    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel-3)] px-3 py-3">
                      <div className="h-[280px] w-full md:h-[320px]">
                        <ResponsiveContainer
                          height="100%"
                          initialDimension={{ width: 960, height: 320 }}
                          minHeight={280}
                          minWidth={0}
                          width="100%"
                        >
                          <AreaChart
                            data={idleBiasTableRows.map((row) => ({
                              label: formatCompactVoltage(row.voltageMv),
                              offsetMa: row.offsetMa,
                            }))}
                            margin={{
                              top: 12,
                              right: 12,
                              bottom: 0,
                              left: 0,
                            }}
                          >
                            <defs>
                              <linearGradient
                                id="idle-bias-area"
                                x1="0"
                                x2="0"
                                y1="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor="var(--primary)"
                                  stopOpacity={0.24}
                                />
                                <stop
                                  offset="100%"
                                  stopColor="var(--primary)"
                                  stopOpacity={0.04}
                                />
                              </linearGradient>
                            </defs>
                            <CartesianGrid
                              stroke="var(--border)"
                              strokeDasharray="2 6"
                              vertical={false}
                            />
                            <XAxis
                              axisLine={false}
                              dataKey="label"
                              interval={3}
                              tick={{
                                fill: "var(--muted)",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                              tickLine={false}
                            />
                            <YAxis
                              axisLine={false}
                              tick={{
                                fill: "var(--muted)",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                              tickFormatter={offsetTickFormatter}
                              tickLine={false}
                              width={52}
                            />
                            <Tooltip
                              content={<IdleBiasTooltip />}
                              cursor={{
                                stroke: "var(--primary)",
                                strokeDasharray: "3 5",
                                strokeOpacity: 0.35,
                              }}
                            />
                            <Area
                              dataKey="offsetMa"
                              fill="url(#idle-bias-area)"
                              fillOpacity={1}
                              isAnimationActive={false}
                              stroke="var(--primary)"
                              strokeWidth={2}
                              type="monotone"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-0 text-[12px]">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-[0.04em] text-[var(--muted)]">
                            {idleBiasTableColumns.map((column) => (
                              <Fragment key={`heading-${column.index}`}>
                                <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                                  Point
                                </th>
                                <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                                  Voltage
                                </th>
                                <th className="border-b border-[var(--border)] px-3 py-2 font-semibold">
                                  Offset
                                </th>
                              </Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {idleBiasTableRowKeys.map((rowKey, rowIndex) => (
                            <tr className="text-[var(--text)]" key={rowKey}>
                              {idleBiasTableColumns.map((column) => {
                                const row = column.rows[rowIndex];
                                if (!row) {
                                  return (
                                    <Fragment
                                      key={`empty-${column.index}-${rowKey}`}
                                    >
                                      <td className="border-b border-[var(--border)]/40 px-3 py-2" />
                                      <td className="border-b border-[var(--border)]/40 px-3 py-2" />
                                      <td className="border-b border-[var(--border)]/40 px-3 py-2" />
                                    </Fragment>
                                  );
                                }
                                return (
                                  <Fragment
                                    key={`${column.index}-${row.index}-${row.voltageMv}`}
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
                                  </Fragment>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {idleBias?.run.state === "running" ? (
          <div className="rounded-[10px] border border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-warning-text)]">
            Calibration progress: {idleBias.run.completed_points}/
            {idleBias.run.point_count}
            {idleBias.run.target_voltage_mv === null
              ? ""
              : ` · target ${formatCompactVoltage(idleBias.run.target_voltage_mv)}`}
            . Power configuration edits are disabled until the sweep finishes.
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
              idleBiasControlsDisabled || idleBias?.dataset.status !== "valid"
            }
            onClick={() => requestIdleBiasAction("clear")}
            type="button"
          >
            Clear dataset
          </button>
        </div>

        {lockedByOtherHost ? (
          <div className="rounded-[10px] border border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-warning-text)]">
            Another host owns the power lock, so idle-bias actions are blocked
            until that lock expires.
          </div>
        ) : null}

        {idleBiasStatus ? (
          <div className="rounded-[10px] border border-[var(--badge-success-border)] bg-[var(--surface-success-bg)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-success-text)]">
            {idleBiasStatus}
          </div>
        ) : null}

        {idleBiasError ? (
          <div
            className="rounded-[10px] border border-[var(--badge-error-border)] bg-[var(--surface-error-bg)] px-4 py-3 text-[12px] font-semibold leading-6 text-[var(--badge-error-text)]"
            role="alert"
          >
            {idleBiasError}
          </div>
        ) : null}
      </section>

      {idleBiasConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="presentation"
        >
          <div
            aria-describedby="idle-bias-confirm-description"
            aria-labelledby="idle-bias-confirm-title"
            aria-modal="true"
            className="w-full max-w-[480px] rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
            role="alertdialog"
          >
            <div
              className="text-[15px] font-bold text-[var(--text)]"
              id="idle-bias-confirm-title"
            >
              {idleBiasConfirm.title}
            </div>
            <div
              className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]"
              id="idle-bias-confirm-description"
            >
              {idleBiasConfirm.description}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="btn btn-outline btn-sm min-h-10 justify-center"
                disabled={idleBiasBusy}
                onClick={() => setIdleBiasConfirm(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm min-h-10 justify-center"
                disabled={idleBiasBusy}
                onClick={() => void confirmIdleBiasAction()}
                type="button"
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
