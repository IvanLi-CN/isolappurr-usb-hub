import type { ConnectionState } from "../../app/device-runtime";
import type { StoredDevice } from "../../domain/devices";
import type { PortId, PortState, PortTelemetry } from "../../domain/ports";
import { formatTimeHms } from "../format/time";
import { PortMiniCard } from "./PortMiniCard";

export type DeviceSummaryCardProps = {
  device: StoredDevice;
  connection: {
    state: ConnectionState;
    lastOkAt?: number;
  };
  ports: Record<
    PortId,
    { label: string; telemetry: PortTelemetry; state: PortState }
  >;
  onOpenDetails: (deviceId: string) => void;
  onSetPower: (deviceId: string, portId: PortId, enabled: boolean) => void;
  onDataReplug: (deviceId: string, portId: PortId) => void;
};

function connectionBadge(state: ConnectionState): {
  bg: string;
  text: string;
  width: string;
} {
  if (state === "online") {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[72px]",
    };
  }
  if (state === "offline") {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[72px]",
    };
  }
  return {
    bg: "bg-[var(--badge-warning-bg)]",
    text: "text-[var(--badge-warning-text)]",
    width: "w-[96px]",
  };
}

export function DeviceSummaryCard({
  device,
  connection,
  ports,
  onOpenDetails,
  onSetPower,
  onDataReplug,
}: DeviceSummaryCardProps) {
  const shortId = device.id.length > 8 ? device.id.slice(0, 8) : device.id;
  const lastOkLabel = connection.lastOkAt
    ? formatTimeHms(connection.lastOkAt)
    : "—";
  const writeDisabled = connection.state !== "online";
  const badge = connectionBadge(connection.state);

  return (
    <div
      className="iso-card h-[272px] w-full rounded-[18px] border border-[var(--border)] bg-[var(--panel)]"
      data-testid={`device-summary-${device.id}`}
    >
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="text-[16px] font-bold">{device.name}</div>
          <div
            className={[
              "flex h-6 items-center justify-center rounded-full",
              badge.width,
              badge.bg,
              badge.text,
              "text-[12px] font-semibold",
            ].join(" ")}
          >
            {connection.state}
          </div>
        </div>

        <div className="font-mono text-[12px] font-semibold text-[var(--muted)]">
          id: {shortId} • last ok: {lastOkLabel}
        </div>

        <div className="flex items-start gap-6">
          <PortMiniCard
            className="w-[260px]"
            portId="port_a"
            label="USB-A"
            telemetry={ports.port_a.telemetry}
            state={ports.port_a.state}
            disabled={writeDisabled}
            onSetPower={(enabled) => onSetPower(device.id, "port_a", enabled)}
            onReplug={() => onDataReplug(device.id, "port_a")}
          />
          <PortMiniCard
            className="w-[252px]"
            portId="port_c"
            label="USB-C"
            telemetry={ports.port_c.telemetry}
            state={ports.port_c.state}
            disabled={writeDisabled}
            onSetPower={(enabled) => onSetPower(device.id, "port_c", enabled)}
            onReplug={() => onDataReplug(device.id, "port_c")}
          />
        </div>

        <button
          className="flex h-[34px] w-full items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[12px] font-bold text-[var(--text)]"
          type="button"
          onClick={() => onOpenDetails(device.id)}
        >
          Open details →
        </button>
      </div>
    </div>
  );
}
