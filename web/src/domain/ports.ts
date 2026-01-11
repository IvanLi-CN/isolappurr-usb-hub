export type PortId = "port_a" | "port_c";

export type TelemetryStatus = "ok" | "not_inserted" | "error" | "overrange";

export type PortTelemetry = {
  status: TelemetryStatus;
  voltage_mv: number | null;
  current_ma: number | null;
  power_mw: number | null;
  sample_uptime_ms: number;
};

export type PortState = {
  power_enabled: boolean;
  data_connected: boolean;
  replugging: boolean;
  busy: boolean;
};

export type PortCapabilities = {
  data_replug: boolean;
  power_set: boolean;
};

export type Port = {
  portId: PortId;
  label: string;
  telemetry: PortTelemetry;
  state: PortState;
  capabilities: PortCapabilities;
};

export type PortsResponse = {
  ports: Port[];
};
