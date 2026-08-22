import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";
import type { PortState, PortTelemetry } from "../../domain/ports";
import type { DevicePowerPanelProps } from "./useDevicePowerPanelState";

const stableOwner = 7;

export const manualConfig: PowerConfigResponse = {
  hardware: "sw2303",
  persisted: true,
  tps_mode: "manual",
  light_load_mode: "pfm",
  sw2303_line_compensation: "50mohm",
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
    voltage_mv: 9000,
    current_limit_ma: 3000,
    usb_c_path_mode: "default",
    tps_cdc_rise_mv: 300,
    path_policy: "auto",
  },
  lock: null,
};

export const autoConfig: PowerConfigResponse = {
  ...manualConfig,
  tps_mode: "auto_follow",
  manual: {
    voltage_mv: 5000,
    current_limit_ma: 1000,
    usb_c_path_mode: "default",
    tps_cdc_rise_mv: 0,
    path_policy: "auto",
  },
};

export const manualOutputOffConfig: PowerConfigResponse = {
  ...manualConfig,
  runtime: {
    output_enabled: false,
    discharge_enabled: true,
  },
};

export const hostLockedConfig: PowerConfigResponse = {
  ...manualConfig,
  lock: { owner: 42, expires_at_ms: Date.now() + 15_000 },
};

export const controlledHereConfig: PowerConfigResponse = {
  ...manualConfig,
  lock: { owner: stableOwner, expires_at_ms: Date.now() + 15_000 },
};

export const controlledAutoConfig: PowerConfigResponse = {
  ...autoConfig,
  lock: { owner: stableOwner, expires_at_ms: Date.now() + 15_000 },
};

export const controlledManualOutputOffConfig: PowerConfigResponse = {
  ...manualOutputOffConfig,
  lock: { owner: stableOwner, expires_at_ms: Date.now() + 15_000 },
};

export const manualForceConfig: PowerConfigResponse = {
  ...manualConfig,
  manual: {
    ...manualConfig.manual,
    usb_c_path_mode: "force",
  },
};

export const fpwmConfig: PowerConfigResponse = {
  ...manualConfig,
  light_load_mode: "fpwm",
};

export const idleBiasMissing: IdleBiasResponse = {
  correction_enabled: false,
  dataset: {
    status: "missing",
    min_voltage_mv: 3000,
    max_voltage_mv: 21000,
    step_mv: 500,
    point_count: 37,
    offsets_ma: null,
  },
  current_applied_offset_ma: null,
  run: {
    state: "idle",
    completed_points: 0,
    point_count: 37,
    target_voltage_mv: null,
    error: null,
  },
};

export const idleBiasReadyOff: IdleBiasResponse = {
  correction_enabled: false,
  dataset: {
    status: "valid",
    min_voltage_mv: 3000,
    max_voltage_mv: 21000,
    step_mv: 500,
    point_count: 37,
    offsets_ma: [
      12, 13, 15, 16, 18, 20, 21, 23, 24, 26, 27, 28, 29, 31, 32, 33, 35, 36,
      37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 54, 55, 56,
      57,
    ],
  },
  current_applied_offset_ma: null,
  run: {
    state: "idle",
    completed_points: 0,
    point_count: 37,
    target_voltage_mv: null,
    error: null,
  },
};

export const idleBiasReadyOn: IdleBiasResponse = {
  ...idleBiasReadyOff,
  correction_enabled: true,
  current_applied_offset_ma: 42,
};

export const idleBiasRunning: IdleBiasResponse = {
  ...idleBiasReadyOff,
  run: {
    state: "running",
    completed_points: 19,
    point_count: 37,
    target_voltage_mv: 12500,
    error: null,
  },
};

export const idleBiasFailed: IdleBiasResponse = {
  ...idleBiasReadyOff,
  run: {
    state: "failed",
    completed_points: 37,
    point_count: 37,
    target_voltage_mv: null,
    error: {
      code: "eeprom_failed",
      message: "Idle-bias calibration could not be saved to EEPROM U21",
    },
  },
};

export const ok = (
  value: PowerConfigResponse,
): Promise<Result<PowerConfigResponse>> => Promise.resolve({ ok: true, value });

export const okIdle = (
  value: IdleBiasResponse,
): Promise<Result<IdleBiasResponse>> => Promise.resolve({ ok: true, value });

export const apiError = (
  message: string,
): Promise<Result<PowerConfigResponse>> =>
  Promise.resolve({
    ok: false,
    error: {
      kind: "api_error",
      status: 409,
      code: "busy",
      message,
      retryable: true,
    },
  });

export const usbCTelemetry: PortTelemetry = {
  status: "ok",
  voltage_mv: 20060,
  current_ma: 30,
  power_mw: 540,
  sample_uptime_ms: 1000,
};

export const usbCState: PortState = {
  power_enabled: true,
  data_connected: true,
  replugging: false,
  busy: false,
};

export const pdDiagnostics: PdDiagnosticsResponse = {
  usb_c_power_enabled: true,
  sw2303_i2c_allowed: true,
  sw2303_profile_applied: true,
  sw2303_stable_reads: 32,
  sw2303_error_latched: false,
  tps_error_latched: false,
  sw2303_readback_config: {
    available: true,
    matches_config: true,
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
  sw2303_request: { mv: 20000, ma: 3000 },
  sw2303_vbus_mv: 20060,
  sw2303_last_valid_request: { mv: 20000, ma: 3000 },
  active_protocol: "pd",
  display: {
    mode: { kind: "pd", label: "PD" },
    measurements_visible: true,
    badge: { kind: "on", label: "ON" },
  },
  usb_c_actual: {
    status: "ok",
    voltage_mv: 20060,
    current_ma: 30,
    power_mw: 540,
    sample_uptime_ms: 1000,
  },
  tps_setpoint: {
    output_enabled: true,
    discharge_enabled: false,
    mv: 20000,
    iout_limit_ma: 3000,
  },
  tps_iout_limit_readback: {
    enabled: true,
    ma: 3000,
  },
  thermal: {
    sensors: {
      mcu: {
        temperature_deci_c: 456,
        status: "ok",
      },
      tmp112: {
        temperature_deci_c: 471,
        status: "ok",
      },
    },
    hottest_temperature_deci_c: 471,
    state: "normal",
    reason: "none",
    effective_power_watts: 100,
    sample_uptime_ms: 1000,
  },
  runtime_recovery_count: 0,
  sample_uptime_ms: 1000,
};

export function withThermal(
  thermal: PdDiagnosticsResponse["thermal"],
): PdDiagnosticsResponse {
  return {
    ...pdDiagnostics,
    thermal,
  };
}

export const defaultArgs: DevicePowerPanelProps = {
  deviceKey: "bench-hub",
  deviceName: "Bench Hub",
  transportLabel: "local_usb",
  coordination: {
    role: "leader",
    currentTabId: "tab-a",
    leaderTabId: "tab-a",
    leaseExpiresAt: new Date(Date.now() + 15_000).toISOString(),
  },
  canControlHardware: true,
  powerLockOwner: stableOwner,
  localAdvancedLocked: false,
  sharedCommand: null,
  sharedRevision: 0,
  sharedPowerConfig: null,
  sharedIdleBiasSnapshot: null,
  sharedPdDiagnostics: null,
  loadPowerConfig: () => ok(manualConfig),
  loadIdleBias: () => okIdle(idleBiasMissing),
  loadPdDiagnostics: () => Promise.resolve({ ok: true, value: pdDiagnostics }),
  savePowerConfig: () => ok(manualConfig),
  restorePowerDefaults: () => ok(autoConfig),
  setPowerLock: () => ok(manualConfig),
  setPowerRuntime: () => ok(manualConfig),
  setIdleBiasCorrection: () => okIdle(idleBiasReadyOn),
  runIdleBiasCalibration: () => okIdle(idleBiasRunning),
  clearIdleBiasCalibration: () => okIdle(idleBiasMissing),
  usbCTelemetry,
  usbCState,
  usbCPending: false,
  usbCDataLinkAvailable: true,
  setUsbCData: async () => ({ ok: true }),
};
