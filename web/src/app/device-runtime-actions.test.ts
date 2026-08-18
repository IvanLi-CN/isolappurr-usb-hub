import { describe, expect, test } from "bun:test";
import type { Result } from "../domain/deviceApi";
import type {
  CrossTabRuntimeCoordinator,
  RuntimeRpcMethod,
  RuntimeRpcResultMap,
} from "./cross-tab-runtime";
import {
  applyConfirmedPortsSnapshot,
  createDeviceRuntimeActions,
  shouldRequestLeaderRpc,
} from "./device-runtime-actions";
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

describe("shouldRequestLeaderRpc", () => {
  test("routes a stale hold callback through the current leader after lease loss", () => {
    expect(shouldRequestLeaderRpc(false, "follower")).toBeTrue();
    expect(shouldRequestLeaderRpc(false, "unsupported")).toBeFalse();
    expect(shouldRequestLeaderRpc(true, "leader")).toBeFalse();
  });
});

describe("runtime action lease handoff", () => {
  test("routes a hold completion through RPC after leadership changes", async () => {
    const calls: Array<[RuntimeRpcMethod, unknown[]]> = [];
    const isLeaderRef = { current: true };
    const coordinationRoleRef = {
      current: "leader" as const,
    };
    const requestLeaderRpc = async <TMethod extends RuntimeRpcMethod>(
      method: TMethod,
      args: unknown[],
    ): Promise<RuntimeRpcResultMap[TMethod]> => {
      calls.push([method, args]);
      return {
        ok: true,
        value: { accepted: true },
      } as RuntimeRpcResultMap[TMethod];
    };
    const unreachable = async <T>(): Promise<Result<T>> => {
      throw new Error("direct device mutation should not run");
    };
    const actions = createDeviceRuntimeActions({
      coordinator: new (class {
        postMessage() {}
      })() as CrossTabRuntimeCoordinator,
      coordinationRole: "leader",
      coordinationRoleRef,
      currentTabId: "tab-leader",
      deviceInfo: unreachable,
      devices: [{ id: "aabbccddeeff", name: "Demo", baseUrl: "http://demo" }],
      isLeader: true,
      isLeaderRef,
      pushToast: () => {},
      requestLeaderRpc,
      refreshCanonicalPowerConfig: unreachable,
      refreshDevice: async () => {},
      runDeviceCommand: unreachable,
      runSharedMutation: unreachable,
      runtimeByIdRef: { current: {} },
      setRuntimeById: () => {},
      syncIdleBiasSnapshot: () => {},
      syncObservedPowerLock: () => {},
      syncPdDiagnosticsSnapshot: () => {},
      syncPowerConfigSnapshot: () => {},
    });

    isLeaderRef.current = false;
    coordinationRoleRef.current = "follower";

    await expect(
      actions.setPower("aabbccddeeff", "port_a", false),
    ).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
    await expect(
      actions.setData("aabbccddeeff", "port_a", false),
    ).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(calls).toEqual([
      ["setPower", ["aabbccddeeff", "port_a", false]],
      ["setData", ["aabbccddeeff", "port_a", false]],
    ]);
  });
});
