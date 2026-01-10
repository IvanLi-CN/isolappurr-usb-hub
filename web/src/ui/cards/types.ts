import type { PortId, PortState, PortTelemetry } from "../../domain/ports";

export type PortCardProps = {
  portId: PortId;
  label: string;
  telemetry: PortTelemetry;
  state: PortState;
  onTogglePower: () => void;
  onReplug: () => void;
};
