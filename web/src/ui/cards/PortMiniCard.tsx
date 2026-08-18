import type { PortId, PortState, PortTelemetry } from "../../domain/ports";
import {
  type HoldActionResult,
  TwoStageHoldButton,
} from "../actions/TwoStageHoldButton";
import { formatTelemetryValue } from "../format/telemetry";

export type PortMiniCardProps = {
  portId: PortId;
  label: string;
  telemetry: PortTelemetry;
  state: PortState;
  disabled: boolean;
  className?: string;
  dataLinkAvailable?: boolean;
  onSetPower: (enabled: boolean) => Promise<HoldActionResult>;
  onSetData: (connected: boolean) => Promise<HoldActionResult>;
};

export function PortMiniCard({
  label,
  telemetry,
  state,
  disabled,
  className,
  onSetPower,
  onSetData,
  dataLinkAvailable = true,
}: PortMiniCardProps) {
  const busy = state.busy;
  const actionDisabled = disabled || busy;

  const valueClass = [
    "text-[16px] font-bold",
    "font-mono",
    actionDisabled ? "text-[var(--muted)]" : "text-[var(--text)]",
  ].join(" ");

  return (
    <div
      className={[
        "iso-card relative h-[144px] border border-[var(--border)] bg-[var(--panel)] px-5 py-4",
        className ?? "",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-semibold text-[var(--muted)]">
          {label}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className={`${valueClass} min-w-0 whitespace-nowrap`}>
          {formatTelemetryValue(telemetry.voltage_mv, "V")}
        </div>
        <div className={`${valueClass} min-w-0 whitespace-nowrap`}>
          {formatTelemetryValue(telemetry.current_ma, "A")}
        </div>
        <div className={`${valueClass} min-w-0 whitespace-nowrap`}>
          {formatTelemetryValue(telemetry.power_mw, "W")}
        </div>
      </div>
      <div className="mt-[14px] grid grid-cols-2 gap-2">
        <TwoStageHoldButton
          className="w-full min-w-0"
          compact
          disabled={actionDisabled}
          label="Power"
          onSetValue={onSetPower}
          value={state.power_enabled}
        />
        <TwoStageHoldButton
          className="w-full min-w-0"
          compact
          disabled={actionDisabled || !dataLinkAvailable}
          label="Data link"
          onSetValue={onSetData}
          unavailableReason={
            dataLinkAvailable
              ? undefined
              : "This firmware does not support the Data link control. Update the device firmware to use it."
          }
          value={state.data_connected}
        />
      </div>
    </div>
  );
}
