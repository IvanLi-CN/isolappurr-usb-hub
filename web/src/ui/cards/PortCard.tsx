import { TwoStageHoldButton } from "../actions/TwoStageHoldButton";
import { formatTelemetryValue } from "../format/telemetry";
import type { PortCardProps } from "./types";

function statusBadgeStyles(status: string): { bg: string; text: string } {
  if (status === "ok") {
    return {
      bg: "bg-[var(--surface-success-bg)] border border-[var(--surface-success-ring)]",
      text: "text-[var(--badge-success-text)]",
    };
  }
  if (status === "error") {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      text: "text-[var(--badge-error-text)]",
    };
  }
  return {
    bg: "bg-[var(--badge-warning-bg)]",
    text: "text-[var(--badge-warning-text)]",
  };
}

export function PortCard({
  portId,
  label,
  telemetry,
  state,
  headerBadges = [],
  showStatusBadge = true,
  disabled,
  powerAvailability = { state: "supported" },
  dataLinkAvailability = { state: "supported" },
  onSetPower,
  onSetData,
}: PortCardProps) {
  const busy = state.busy;
  const actionDisabled = !!disabled || busy;
  const dataSwitching = state.replugging;
  const dataLinkDisabled =
    actionDisabled ||
    dataSwitching ||
    dataLinkAvailability.state !== "supported";
  const dataLinkReason = dataSwitching
    ? "Data path is switching. Wait for it to finish."
    : dataLinkAvailability.reason;
  const badge = statusBadgeStyles(telemetry.status);

  return (
    <div
      className="iso-card relative flex h-full min-h-[236px] flex-col border border-[var(--border)] bg-[var(--panel)] p-6"
      data-testid={`port-card-${portId}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 text-[16px] font-bold">{label}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {headerBadges.map((headerBadge) => (
            <div
              className={[
                "flex h-6 items-center justify-center rounded-full border px-3",
                "whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.04em]",
                headerBadge.toneClassName,
              ].join(" ")}
              data-testid={headerBadge.testId}
              key={`${portId}-${headerBadge.testId ?? headerBadge.label}`}
            >
              {headerBadge.label}
            </div>
          ))}
          {showStatusBadge ? (
            <div
              className={[
                "flex h-6 min-w-[60px] items-center justify-center rounded-full px-3",
                badge.bg,
                badge.text,
                "whitespace-nowrap text-[12px] font-semibold",
              ].join(" ")}
              data-testid={`port-card-status-${portId}`}
            >
              {telemetry.status === "not_inserted"
                ? "not inserted"
                : telemetry.status === "ok"
                  ? "OK"
                  : telemetry.status}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-6 sm:gap-10">
        <div>
          <div className="text-[12px] font-semibold text-[var(--muted)]">
            Voltage
          </div>
          <div className="mt-2 min-w-0 whitespace-nowrap font-mono text-[18px] font-bold sm:text-[24px]">
            {formatTelemetryValue(telemetry.voltage_mv, "V")}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-semibold text-[var(--muted)]">
            Current
          </div>
          <div className="mt-2 min-w-0 whitespace-nowrap font-mono text-[18px] font-bold sm:text-[24px]">
            {formatTelemetryValue(telemetry.current_ma, "A")}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-semibold text-[var(--muted)]">
            Power
          </div>
          <div className="mt-2 min-w-0 whitespace-nowrap font-mono text-[18px] font-bold sm:text-[24px]">
            {formatTelemetryValue(telemetry.power_mw, "W")}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <TwoStageHoldButton
          className="w-full sm:w-[180px]"
          disabled={actionDisabled || powerAvailability.state !== "supported"}
          label="Power"
          onSetValue={onSetPower}
          unavailableReason={powerAvailability.reason}
          value={state.power_enabled}
        />
        <TwoStageHoldButton
          className="w-full sm:w-[190px]"
          disabled={dataLinkDisabled}
          label="Data link"
          onSetValue={onSetData}
          unavailableReason={dataLinkReason}
          unavailableTone={dataSwitching ? "warning" : "neutral"}
          value={state.data_connected}
        />
      </div>
    </div>
  );
}
