export function formatThermalTemperature(
  value: number | null | undefined,
): string {
  if (typeof value !== "number") {
    return "—";
  }
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 10)}.${absolute % 10}°C`;
}

export function thermalSensorStatusLabel(status: string): string {
  if (status === "ok") {
    return "OK";
  }
  if (status === "stale") {
    return "Stale";
  }
  if (status === "error") {
    return "Error";
  }
  return status;
}

export function thermalReasonLabel(reason: string): string {
  switch (reason) {
    case "none":
      return "No limit active";
    case "mcu_hot":
      return "MCU hot";
    case "tmp112_hot":
      return "TMP112 hot";
    case "both_hot":
      return "MCU + TMP112 hot";
    case "mcu_critical":
      return "MCU critical";
    case "tmp112_critical":
      return "TMP112 critical";
    case "both_critical":
      return "MCU + TMP112 critical";
    case "mcu_sensor_fault":
      return "MCU sensor fault";
    case "tmp112_sensor_fault":
      return "TMP112 sensor fault";
    case "both_sensor_fault":
      return "MCU + TMP112 sensor fault";
    default:
      return reason;
  }
}

export function thermalStateLabel(state: string): string {
  switch (state) {
    case "normal":
      return "Normal";
    case "derating":
      return "Derating";
    case "shutdown":
      return "Shutdown";
    case "rearm_required":
      return "Rearm required";
    case "sensor_fault":
      return "Sensor fault";
    default:
      return state;
  }
}

export function thermalStateTone(state: string): string {
  if (state === "normal") {
    return "border-[var(--badge-success-border)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]";
  }
  if (state === "derating" || state === "rearm_required") {
    return "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]";
  }
  return "border-[var(--badge-error-border)] bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]";
}

export function thermalSensorTone(status: string): string {
  if (status === "ok") {
    return "border-[var(--badge-success-border)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]";
  }
  if (status === "stale") {
    return "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]";
  }
  return "border-[var(--badge-error-border)] bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]";
}

export function thermalAttentionMessage(state: string): string | null {
  switch (state) {
    case "derating":
      return "Live power is being derated. Every degree above 80°C removes 5 W from the active ceiling.";
    case "shutdown":
      return "Output is forced off above 100°C. Let both sensors cool below 98°C, then re-enable Power manually.";
    case "rearm_required":
      return "Temperatures recovered. Output stays off until you turn Power back on manually.";
    case "sensor_fault":
      return "Temperature telemetry failed. Output stays off until both sensors recover, then turn Power back on manually.";
    default:
      return null;
  }
}
