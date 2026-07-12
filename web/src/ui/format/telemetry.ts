export type TelemetryUnit = "V" | "A" | "W";

export function formatTelemetryValue(
  value: number | null,
  unit: TelemetryUnit,
): string {
  if (value === null) {
    return `--.---${unit}`;
  }
  return `${(value / 1000).toFixed(3)}${unit}`;
}
