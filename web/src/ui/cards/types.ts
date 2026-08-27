import type {
  PortControlAvailability,
  PortId,
  PortState,
  PortTelemetry,
} from "../../domain/ports";
import type { HoldActionResult } from "../actions/TwoStageHoldButton";

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
  powerAvailability?: PortControlAvailability;
  dataLinkAvailability?: PortControlAvailability;
  onSetPower: (enabled: boolean) => Promise<HoldActionResult>;
  onSetData: (connected: boolean) => Promise<HoldActionResult>;
};
