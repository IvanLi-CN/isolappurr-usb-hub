export type PortId = "port_a" | "port_c";

export type PortTelemetry = {
  voltage_mv: number;
  current_ma: number;
  power_mw: number;
  updated_at?: string;
};

export type PortState = {
  power_enabled: boolean;
  replugging: boolean;
};
