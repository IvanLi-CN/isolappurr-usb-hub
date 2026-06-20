import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";

import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";
import type { PortState, PortTelemetry } from "../../domain/ports";
import { DevicePowerPanel } from "./DevicePowerPanel";

const manualConfig: PowerConfigResponse = {
  hardware: "sw2303",
  persisted: true,
  tps_mode: "manual",
  light_load_mode: "pfm",
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
    path_policy: "auto",
  },
  lock: null,
};

const autoConfig: PowerConfigResponse = {
  ...manualConfig,
  tps_mode: "auto_follow",
  manual: {
    voltage_mv: 5000,
    current_limit_ma: 1000,
    usb_c_path_mode: "default",
    path_policy: "auto",
  },
};

const manualOutputOffConfig: PowerConfigResponse = {
  ...manualConfig,
  runtime: {
    output_enabled: false,
    discharge_enabled: true,
  },
};

const hostLockedConfig: PowerConfigResponse = {
  ...manualConfig,
  lock: { owner: 42, expires_at_ms: Date.now() + 15_000 },
};

const manualForceConfig: PowerConfigResponse = {
  ...manualConfig,
  manual: {
    ...manualConfig.manual,
    usb_c_path_mode: "force",
  },
};

const fpwmConfig: PowerConfigResponse = {
  ...manualConfig,
  light_load_mode: "fpwm",
};

const idleBiasMissing: IdleBiasResponse = {
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

const idleBiasReadyOff: IdleBiasResponse = {
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

const idleBiasReadyOn: IdleBiasResponse = {
  ...idleBiasReadyOff,
  correction_enabled: true,
  current_applied_offset_ma: 42,
};

const idleBiasRunning: IdleBiasResponse = {
  ...idleBiasReadyOff,
  run: {
    state: "running",
    completed_points: 19,
    point_count: 37,
    target_voltage_mv: 12500,
    error: null,
  },
};

const idleBiasFailed: IdleBiasResponse = {
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

const ok = (value: PowerConfigResponse): Promise<Result<PowerConfigResponse>> =>
  Promise.resolve({ ok: true, value });

const okIdle = (value: IdleBiasResponse): Promise<Result<IdleBiasResponse>> =>
  Promise.resolve({ ok: true, value });

const apiError = (message: string): Promise<Result<PowerConfigResponse>> =>
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

const usbCTelemetry: PortTelemetry = {
  status: "ok",
  voltage_mv: 20060,
  current_ma: 30,
  power_mw: 540,
  sample_uptime_ms: 1000,
};

const usbCState: PortState = {
  power_enabled: true,
  data_connected: true,
  replugging: false,
  busy: false,
};

const pdDiagnostics: PdDiagnosticsResponse = {
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
  runtime_recovery_count: 0,
  sample_uptime_ms: 1000,
};

const meta: Meta<typeof DevicePowerPanel> = {
  title: "Panels/DevicePowerPanel",
  component: DevicePowerPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-[var(--bg)] p-6">
        <div className="mx-auto max-w-[1280px]">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DevicePowerPanel>;

const defaultArgs: Story["args"] = {
  deviceKey: "bench-hub",
  deviceName: "Bench Hub",
  transportLabel: "local_usb",
  localAdvancedLocked: false,
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
  replugUsbC: async () => undefined,
};

export const Default: Story = {
  args: defaultArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("PD-negotiation-badge"),
    ).toBeVisible();
    await expect(canvas.getByTestId("PPS-negotiation-badge")).toHaveTextContent(
      "CC",
    );
    await expect(canvas.getByTestId("QC2-negotiation-badge")).toHaveTextContent(
      "DPDM",
    );
    await expect(
      await canvas.findByRole("button", { name: "Run calibration" }),
    ).toBeVisible();
    await expect(await canvas.findByText("Missing")).toBeVisible();
    await userEvent.click(
      await canvas.findByRole("button", { name: /4 PDO/i }),
    );
    await expect(await canvas.findByText("Fixed PDO")).toBeVisible();
    await expect(await canvas.findByText("12V")).toBeVisible();
  },
};

export const HostLocked: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(hostLockedConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setPowerLock: () => apiError("Power settings are locked by another host"),
    transportLabel: "http",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Host lock active")).toBeVisible();
    await expect(
      canvas.getByRole("slider", { name: /Voltage/ }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Run calibration" }),
    ).toBeDisabled();
  },
};

export const AutoFollowDefaults: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(autoConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    savePowerConfig: () => ok(autoConfig),
    setPowerLock: () => ok(autoConfig),
  },
};

export const OutputOffManualHighVoltage: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(manualOutputOffConfig),
    savePowerConfig: () => ok(manualOutputOffConfig),
    setPowerLock: () => ok(manualOutputOffConfig),
    setPowerRuntime: () => ok(manualOutputOffConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Power off")).toBeVisible();
    await expect(
      await canvas.findByTestId("runtime-output-toggle"),
    ).toHaveTextContent("Power");
    await expect(
      await canvas.findByTestId("runtime-discharge-toggle"),
    ).toHaveTextContent("Enabled");
    await expect(await canvas.findByTestId("usb-c-voltage")).toHaveTextContent(
      "20.06V",
    );
    await expect(await canvas.findByTestId("usb-c-current")).toHaveTextContent(
      "0.03A",
    );
    await expect(await canvas.findByTestId("usb-c-power")).toHaveTextContent(
      "0.54W",
    );
  },
};

export const ForcedPwmMode: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(fpwmConfig),
    savePowerConfig: () => ok(fpwmConfig),
    setPowerLock: () => ok(fpwmConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "FPWM" }),
    ).toHaveTextContent("FPWM");
    await userEvent.click(
      await canvas.findByLabelText("TPS light-load mode help"),
    );
    await expect(
      await canvas.findByText(/PFM follows the board default/i),
    ).toBeVisible();
  },
};

export const SaveManualFlow: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(autoConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    savePowerConfig: (_input, _owner) => ok(manualConfig),
    setPowerLock: () => ok(autoConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Manual TPS" }),
    );
    const voltageInput = canvas.getAllByRole("textbox")[0];
    await userEvent.clear(voltageInput);
    await userEvent.type(voltageInput, "9000");
    await userEvent.click(
      canvas.getByRole("button", { name: "Save and apply" }),
    );
    await expect(await canvas.findByText("Saved and applied")).toBeVisible();
  },
};

export const RestoreDefaultsFlow: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    restorePowerDefaults: () => ok(autoConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Restore defaults" }),
    );
    await expect(await canvas.findByText("Defaults restored")).toBeVisible();
  },
};

export const CalibrationReadyCorrectionOff: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setIdleBiasCorrection: () => okIdle(idleBiasReadyOn),
  },
};

export const CalibrationApplied: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOn),
    setIdleBiasCorrection: () => okIdle(idleBiasReadyOff),
  },
};

export const CalibrationDatasetExpanded: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", {
        name: /Calibration dataset table/i,
      }),
    );
    await expect(
      await canvas.findByRole("tab", { name: "Chart", selected: true }),
    ).toBeVisible();
    await expect(
      await canvas.findByText(/voltage to idle-current drift/i),
    ).toBeVisible();
  },
};

export const CalibrationDatasetTableView: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", {
        name: /Calibration dataset table/i,
      }),
    );
    await userEvent.click(await canvas.findByRole("tab", { name: "Table" }));
    await expect(
      await canvas.findByRole("tab", { name: "Table", selected: true }),
    ).toBeVisible();
    await expect(await canvas.findAllByText("Point")).toHaveLength(3);
    await expect(await canvas.findByText("21 V")).toBeVisible();
    await expect(await canvas.findByText("20.5 V")).toBeVisible();
  },
};

export const CalibrationRunning: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasRunning),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/Calibration progress: 19\/37/),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Run calibration" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("slider", { name: /Voltage/ }),
    ).toBeDisabled();
  },
};

export const RunConfirmation: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasMissing),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Run calibration" }),
    );
    await expect(
      await canvas.findByRole("alertdialog", {
        name: "Run USB-C idle-bias calibration?",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByText(/Disconnect every USB-C device first/),
    ).toBeVisible();
  },
};

export const FailureState: Story = {
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasFailed),
  },
};

export const ApiFailure: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => apiError("EEPROM U21 write failed"),
  },
};

export const Narrow: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrNarrow" },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[390px]">
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("PD");
    await expect(
      canvas.queryByTestId("PD-negotiation-badge"),
    ).not.toBeVisible();
    await expect(
      canvas.queryByTestId("QC2-negotiation-badge"),
    ).not.toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: /4 PDO/i }),
    ).toBeVisible();
  },
};

export const MediumWideCards: Story = {
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[720px]" data-medium-wide-cards>
        <style>{`
          [data-medium-wide-cards] .protocol-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        `}</style>
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("PD-negotiation-badge"),
    ).toBeVisible();
    await expect(canvas.getByTestId("QC2-negotiation-badge")).toBeVisible();
  },
};

export const ManualForceConfigOnly: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(manualForceConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    savePowerConfig: () => ok(manualForceConfig),
    setPowerLock: () => ok(manualForceConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Manual TPS" }),
    ).toBeVisible();
    await expect(canvas.getByText("Force")).toBeVisible();
    await expect(
      canvas.queryByText("USB-C source state"),
    ).not.toBeInTheDocument();
  },
};
