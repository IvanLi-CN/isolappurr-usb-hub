import { describe, expect, test } from "bun:test";

import type { PowerConfigResponse } from "../../domain/deviceApi";
import { cloneConfig } from "./DevicePowerPanelControls";
import {
  applyOutputModeDraft,
  extractOutputModeDraft,
  mergeNonOutputModeFields,
  serializeOutputModeDraft,
} from "./devicePowerPanelOutputMode";

const baseConfig: PowerConfigResponse = {
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

describe("device power output mode drafts", () => {
  test("serializes only the Output mode slice", () => {
    const form = cloneConfig(baseConfig);
    expect(serializeOutputModeDraft(extractOutputModeDraft(form))).toBe(
      JSON.stringify({
        tps_mode: "manual",
        manual: {
          voltage_mv: 9000,
          current_limit_ma: 3000,
          tps_cdc_rise_mv: 300,
          usb_c_path_mode: "default",
        },
      }),
    );
  });

  test("applies an Output mode draft without mutating other persisted fields", () => {
    const form = cloneConfig(baseConfig);
    const next = applyOutputModeDraft(form, {
      tps_mode: "auto_follow",
      manual: {
        voltage_mv: 5000,
        current_limit_ma: 1000,
        tps_cdc_rise_mv: 0,
        usb_c_path_mode: "force",
      },
    });

    expect(next.capability).toEqual(form.capability);
    expect(next.light_load_mode).toBe("pfm");
    expect(next.sw2303_line_compensation).toBe("50mohm");
    expect(next.tps_mode).toBe("auto_follow");
    expect(next.manual).toMatchObject({
      voltage_mv: 5000,
      current_limit_ma: 1000,
      tps_cdc_rise_mv: 0,
      usb_c_path_mode: "force",
    });
  });

  test("merges non-Output mode local edits back onto a newer canonical snapshot", () => {
    const canonicalForm = cloneConfig(baseConfig);
    const localForm = cloneConfig({
      ...baseConfig,
      light_load_mode: "fpwm",
      sw2303_line_compensation: "100mohm",
      capability: {
        ...baseConfig.capability,
        power_watts: 83,
      },
      manual: {
        ...baseConfig.manual,
        voltage_mv: 12000,
        usb_c_path_mode: "force",
      },
    });

    const merged = mergeNonOutputModeFields(canonicalForm, localForm);

    expect(merged.light_load_mode).toBe("fpwm");
    expect(merged.sw2303_line_compensation).toBe("100mohm");
    expect(merged.capability.power_watts).toBe(83);
    expect(merged.tps_mode).toBe("manual");
    expect(merged.manual).toMatchObject({
      voltage_mv: 9000,
      current_limit_ma: 3000,
      tps_cdc_rise_mv: 300,
      usb_c_path_mode: "default",
    });
  });
});
