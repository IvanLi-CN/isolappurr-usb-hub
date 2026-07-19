import { describe, expect, test } from "bun:test";
import { PD_DIAGNOSTICS_REFRESH_MS } from "./devicePowerPanelRefresh";
import {
  formatThermalTemperature,
  thermalAttentionMessage,
  thermalReasonLabel,
  thermalSensorStatusLabel,
  thermalStateLabel,
} from "./devicePowerThermal";

describe("device power thermal formatting", () => {
  test("formats the five owner-facing thermal states", () => {
    expect(thermalStateLabel("normal")).toBe("Normal");
    expect(thermalStateLabel("derating")).toBe("Derating");
    expect(thermalStateLabel("shutdown")).toBe("Shutdown");
    expect(thermalStateLabel("rearm_required")).toBe("Rearm required");
    expect(thermalStateLabel("sensor_fault")).toBe("Sensor fault");
  });

  test("formats temperatures and sensor status labels", () => {
    expect(formatThermalTemperature(851)).toBe("85.1°C");
    expect(formatThermalTemperature(-25)).toBe("-2.5°C");
    expect(formatThermalTemperature(null)).toBe("—");
    expect(thermalSensorStatusLabel("ok")).toBe("OK");
    expect(thermalSensorStatusLabel("stale")).toBe("Stale");
    expect(thermalSensorStatusLabel("error")).toBe("Error");
  });

  test("maps thermal reasons and restart guidance", () => {
    expect(thermalReasonLabel("tmp112_hot")).toBe("TMP112 hot");
    expect(thermalReasonLabel("mcu_critical")).toBe("MCU critical");
    expect(thermalReasonLabel("tmp112_sensor_fault")).toBe(
      "TMP112 sensor fault",
    );
    expect(thermalAttentionMessage("normal")).toBeNull();
    expect(thermalAttentionMessage("derating")).toContain("Every degree above");
    expect(thermalAttentionMessage("shutdown")).toContain("forced off");
    expect(thermalAttentionMessage("rearm_required")).toContain(
      "turn Power back on manually",
    );
    expect(thermalAttentionMessage("sensor_fault")).toContain(
      "both sensors recover",
    );
  });

  test("keeps pd-diagnostics polling aligned to one second", () => {
    expect(PD_DIAGNOSTICS_REFRESH_MS).toBe(1_000);
  });
});
