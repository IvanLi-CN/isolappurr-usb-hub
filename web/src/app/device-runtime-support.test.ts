import { describe, expect, test } from "bun:test";

import {
  applyOptimisticPowerConfig,
  canResumePowerLock,
  clearPowerLockResume,
  type DeviceRuntime,
  getStablePowerLockOwner,
  markPowerLockHeld,
  resolveActiveDeviceTransport,
  resolveOrderedDeviceTransports,
} from "./device-runtime-support";

const STALE_LOCAL_USB_DEVICE = {
  id: "856a141cdbd4",
  name: "Bench Hub",
  baseUrl: "http://192.168.31.122",
  transports: {
    httpBaseUrl: "http://192.168.31.122",
    localUsbPortPath: "/dev/cu.usbmodem21231401",
  },
};

function runtimeWithVerifiedHttp(): DeviceRuntime {
  const now = Date.now();
  return {
    lastOkAt: now,
    lastError: null,
    transport: null,
    channels: {
      http: { lastOkAt: now, lastError: null },
      web_serial: { lastOkAt: null, lastError: null },
      local_usb: { lastOkAt: null, lastError: null },
    },
    hub: null,
    ports: null,
    pending: { port_a: false, port_c: false },
  };
}

const BASE_POWER_CONFIG = {
  hardware: "sw2303",
  persisted: true,
  tps_mode: "auto_follow" as const,
  light_load_mode: "pfm" as const,
  sw2303_line_compensation: "50mohm" as const,
  runtime: {
    output_enabled: true,
    discharge_enabled: false,
  },
  capability: {
    profile: "full",
    power_watts: 100,
    protocols: {
      pd: true,
      qc20: true,
      qc30: true,
      fcp: true,
      afc: true,
      scp: true,
      pe20: true,
      bc12: true,
      sfcp: true,
    },
    pd: {
      pps: true,
      fixed_voltages_mv: [9000, 12000, 15000, 20000],
    },
    current: {
      pps3_limit_ma: 5000,
      pd_pps_5a: false,
      type_c_broadcast_ma: 500,
      scp_limit_ma: 5000,
      fcp_afc_sfcp_limit_ma: 3250,
    },
    fast_charge: {
      qc20_20v_enabled: true,
      qc30_20v_enabled: true,
      pe20_20v_enabled: true,
      non_pd_12v_enabled: true,
    },
  },
  manual: {
    voltage_mv: 5000,
    current_limit_ma: 3000,
    usb_c_path_mode: "default" as const,
    tps_cdc_rise_mv: 0 as const,
    path_policy: "auto",
  },
  lock: {
    owner: 7,
    expires_at_ms: 123456,
  },
};

function mockPowerLockStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  });
  return store;
}

describe("historical local usb bindings", () => {
  test("applies optimistic power-config writes without dropping runtime-only fields", () => {
    const next = applyOptimisticPowerConfig(BASE_POWER_CONFIG, {
      hardware: "sw2303",
      tps_mode: "manual",
      light_load_mode: "fpwm",
      sw2303_line_compensation: "100mohm",
      capability: {
        ...BASE_POWER_CONFIG.capability,
        power_watts: 67,
      },
      manual: {
        voltage_mv: 9000,
        current_limit_ma: 5200,
        usb_c_path_mode: "force",
        tps_cdc_rise_mv: 500,
      },
    });

    expect(next).not.toBeNull();
    expect(next?.capability.power_watts).toBe(67);
    expect(next?.manual.path_policy).toBe("auto");
    expect(next?.runtime).toEqual(BASE_POWER_CONFIG.runtime);
    expect(next?.lock).toEqual(BASE_POWER_CONFIG.lock);
  });

  test("returns null when no canonical power config exists yet", () => {
    expect(
      applyOptimisticPowerConfig(null, {
        hardware: "sw2303",
        tps_mode: "auto_follow",
        light_load_mode: "pfm",
        sw2303_line_compensation: "50mohm",
        capability: BASE_POWER_CONFIG.capability,
        manual: {
          voltage_mv: 5000,
          current_limit_ma: 3000,
          usb_c_path_mode: "default",
          tps_cdc_rise_mv: 0,
        },
      }),
    ).toBeNull();
  });

  test("reuses the same persisted power lock owner across reads", () => {
    mockPowerLockStorage();
    const first = getStablePowerLockOwner("device-a");
    const second = getStablePowerLockOwner("device-a");
    expect(second).toBe(first);
  });

  test("tracks and clears resumable power lock ownership", () => {
    mockPowerLockStorage();
    expect(canResumePowerLock("device-a", 1_000)).toBe(false);
    markPowerLockHeld("device-a", 1_000);
    expect(canResumePowerLock("device-a", 1_001)).toBe(true);
    expect(canResumePowerLock("device-a", 16_001)).toBe(false);
    clearPowerLockResume("device-a");
    expect(canResumePowerLock("device-a", 1_001)).toBe(false);
  });

  test("prefers the persisted owner over a stale in-memory cache", () => {
    const store = mockPowerLockStorage();
    const deviceKey = "device-race";
    const first = getStablePowerLockOwner(deviceKey);
    store.set(
      "isolapurr.runtime.power-lock-owners.v1",
      JSON.stringify({
        [deviceKey]: {
          ownerId: first + 1,
          resumeUntilMs: 0,
          updatedAtMs: 1,
        },
      }),
    );

    expect(getStablePowerLockOwner(deviceKey)).toBe(first + 1);
  });

  test("keep verified http ahead of a stored-but-not-live local usb binding", () => {
    expect(
      resolveOrderedDeviceTransports({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: null,
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: false,
      }),
    ).toEqual(["http", "local_usb"]);
  });

  test("drop local usb while flash page locks the device to web serial", () => {
    expect(
      resolveOrderedDeviceTransports({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: "web_serial",
        localUsbPortPath: "/dev/cu.usbmodem21231401",
        hasLocalUsbLink: true,
        hasWebSerialLink: false,
        localUsbSuppressed: true,
      }),
    ).toEqual(["http"]);
  });

  test("prefer verified http over a historical local usb path", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: runtimeWithVerifiedHttp(),
        preferred: null,
        localUsbPortPath: null,
        hasLocalUsbLink: false,
        hasWebSerialLink: false,
      }),
    ).toBe("http");
  });

  test("never reports local usb active while flash page suppresses it", () => {
    expect(
      resolveActiveDeviceTransport({
        deviceId: "856a141cdbd4",
        devices: [STALE_LOCAL_USB_DEVICE],
        runtime: {
          ...runtimeWithVerifiedHttp(),
          transport: "local_usb",
          channels: {
            http: { lastOkAt: null, lastError: null },
            web_serial: { lastOkAt: null, lastError: null },
            local_usb: { lastOkAt: Date.now(), lastError: null },
          },
        },
        preferred: "local_usb",
        localUsbPortPath: "/dev/cu.usbmodem21231401",
        hasLocalUsbLink: true,
        hasWebSerialLink: false,
        localUsbSuppressed: true,
      }),
    ).toBe("http");
  });
});
