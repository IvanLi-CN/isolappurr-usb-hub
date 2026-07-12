import { describe, expect, test } from "bun:test";

import { formatTelemetryValue } from "./telemetry";

describe("formatTelemetryValue", () => {
  test("preserves milli-unit telemetry with three decimal places", () => {
    expect(formatTelemetryValue(9030, "V")).toBe("9.030V");
    expect(formatTelemetryValue(470, "A")).toBe("0.470A");
    expect(formatTelemetryValue(4280, "W")).toBe("4.280W");
  });

  test("renders zero and missing telemetry at the same precision", () => {
    expect(formatTelemetryValue(0, "W")).toBe("0.000W");
    expect(formatTelemetryValue(null, "V")).toBe("--.---V");
  });
});
