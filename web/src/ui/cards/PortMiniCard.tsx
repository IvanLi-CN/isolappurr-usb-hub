import { useRef } from "react";

import type {
  PortControlAvailability,
  PortId,
  PortState,
  PortTelemetry,
} from "../../domain/ports";
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
  powerAvailability?: PortControlAvailability;
  dataLinkAvailability?: PortControlAvailability;
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
  powerAvailability = { state: "supported" },
  dataLinkAvailability = { state: "supported" },
}: PortMiniCardProps) {
  const busy = state.busy;
  const actionDisabled = disabled || busy;
  const dataSwitching = state.replugging;
  const confirmedDataValueRef = useRef(state.data_connected);
  if (!dataSwitching) {
    confirmedDataValueRef.current = state.data_connected;
  }
  const dataLinkValue = dataSwitching
    ? confirmedDataValueRef.current
    : state.data_connected;
  const dataLinkDisabled =
    actionDisabled ||
    dataSwitching ||
    dataLinkAvailability.state !== "supported";
  const dataLinkReason = dataSwitching
    ? "Data path is switching. Wait for it to finish."
    : dataLinkAvailability.reason;

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
          disabled={actionDisabled || powerAvailability.state !== "supported"}
          label="Power"
          onSetValue={onSetPower}
          unavailableReason={powerAvailability.reason}
          value={state.power_enabled}
        />
        <TwoStageHoldButton
          className="w-full min-w-0"
          compact
          disabled={dataLinkDisabled}
          label="Data link"
          onSetValue={onSetData}
          unavailableReason={dataLinkReason}
          unavailableTone={dataSwitching ? "warning" : "neutral"}
          value={dataLinkValue}
        />
      </div>
    </div>
  );
}
