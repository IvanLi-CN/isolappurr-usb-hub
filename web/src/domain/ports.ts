export type PortId = "port_a" | "port_c";
export type UsbCDownstreamRoute = "mcu" | "usb_c";

export type TelemetryStatus = "ok" | "not_inserted" | "error" | "overrange";

export type HubState = {
  // Backward-compat: older firmware and summary cards use this field.
  upstream_connected: boolean;
  isolated_usb_fault?: boolean;
  isolated_downstream_connected?: boolean;
  isolated_usb_ready?: boolean;
  usb_c_downstream_route?: UsbCDownstreamRoute;
  usb_c_downstream_persisted?: boolean;
  capabilities?: { identify?: boolean };
};

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
  data_replug?: boolean;
  data_set?: boolean;
  power_set?: boolean;
};

export type PortControl = keyof PortCapabilities;
export type PortControlAvailabilityState =
  | "supported"
  | "unsupported"
  | "unknown";

export type PortControlAvailability = {
  state: PortControlAvailabilityState;
  reason?: string;
};

export type Port = {
  portId: PortId;
  label: string;
  capability_schema?: number;
  telemetry: PortTelemetry;
  telemetry_raw?: PortTelemetry | null;
  state: PortState;
  capabilities: PortCapabilities;
};

export function portWithCapabilitySchema(
  port: Port,
  capabilitySchema: number | undefined,
): Port {
  return { ...port, capability_schema: capabilitySchema };
}

export function runtimePortsFromResponse(
  response: PortsResponse,
): Record<PortId, Port> | null {
  const portA = response.ports.find((port) => port.portId === "port_a");
  const portC = response.ports.find((port) => port.portId === "port_c");
  return portA && portC
    ? {
        port_a: portWithCapabilitySchema(portA, response.capability_schema),
        port_c: portWithCapabilitySchema(portC, response.capability_schema),
      }
    : null;
}

export type PortsResponse = {
  // Backward-compat: older firmware may omit `hub` entirely.
  hub?: HubState;
  capability_schema?: number;
  capabilities?: { identify?: boolean };
  ports: Port[];
};

const PORT_CONTROL_LABELS: Record<PortControl, string> = {
  data_replug: "Data replug",
  data_set: "Data link",
  power_set: "Power",
};

export function resolvePortControlAvailability(
  capabilitySchema: number | undefined,
  capabilities: PortCapabilities | null | undefined,
  control: PortControl,
): PortControlAvailability {
  if (capabilitySchema !== 1 || typeof capabilities?.[control] !== "boolean") {
    return {
      state: "unknown",
      reason: `This device has not declared the ${PORT_CONTROL_LABELS[control]} control capability, so it is unavailable.`,
    };
  }

  if (capabilities[control]) {
    return { state: "supported" };
  }

  return {
    state: "unsupported",
    reason: `This device does not support the ${PORT_CONTROL_LABELS[control]} control.`,
  };
}
