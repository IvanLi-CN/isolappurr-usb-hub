import type { PortId, PortState, PortTelemetry } from "../../domain/ports";

export type PortCardHeaderBadge = {
  label: string;
  toneClassName: string;
  testId?: string;
};

export type PortCardProps = {
  portId: PortId;
  label: string;
  telemetry: PortTelemetry;
  state: PortState;
  headerBadges?: PortCardHeaderBadge[];
  showStatusBadge?: boolean;
  disabled?: boolean;
  onTogglePower: () => void;
  onReplug: () => void;
};
