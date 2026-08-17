import { describe, expect, test } from "bun:test";

import { applyConfirmedPortsSnapshot } from "./device-runtime-actions";
import type { DeviceRuntime } from "./device-runtime-support";

function runtime(): DeviceRuntime {
  return {
    lastOkAt: null,
    lastError: { kind: "offline", message: "stale" },
    transport: "http",
    channels: {
      http: { lastOkAt: null, lastError: null },
      web_serial: { lastOkAt: null, lastError: null },
      local_usb: { lastOkAt: null, lastError: null },
    },
    hub: null,
    ports: null,
    pending: { port_a: false, port_c: false },
  };
}

describe("applyConfirmedPortsSnapshot", () => {
  test("commits a confirmed device snapshot without waiting for another poll", () => {
    const next = applyConfirmedPortsSnapshot(runtime(), {
      hub: {
        upstream_connected: true,
        capabilities: { identify: true },
      },
      ports: [
        {
          portId: "port_a",
          label: "USB-A",
          telemetry: {
            status: "ok",
            voltage_mv: 5000,
            current_ma: 100,
            power_mw: 500,
            sample_uptime_ms: 1,
          },
          state: {
            power_enabled: false,
            data_connected: false,
            replugging: false,
            busy: false,
          },
          capabilities: { data_replug: true, data_set: true, power_set: true },
        },
        {
          portId: "port_c",
          label: "USB-C",
          telemetry: {
            status: "ok",
            voltage_mv: 9000,
            current_ma: 100,
            power_mw: 900,
            sample_uptime_ms: 1,
          },
          state: {
            power_enabled: true,
            data_connected: true,
            replugging: false,
            busy: false,
          },
          capabilities: { data_replug: true, data_set: true, power_set: true },
        },
      ],
    });

    expect(next.lastError).toBeNull();
    expect(next.ports?.port_a.state.power_enabled).toBeFalse();
    expect(next.ports?.port_a.state.data_connected).toBeFalse();
    expect(next.hub?.upstream_connected).toBeTrue();
  });
});
