import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import type { PdDiagnosticsResponse } from "../../domain/deviceApi";
import { ToastProvider } from "../toast/ToastProvider";
import { DevicePowerPanel } from "./DevicePowerPanel";
import {
  apiError,
  controlledAutoConfig,
  controlledHereConfig,
  controlledManualOutputOffConfig,
  defaultArgs,
  fpwmConfig,
  hostLockedConfig,
  idleBiasFailed,
  idleBiasMissing,
  idleBiasReadyOff,
  idleBiasReadyOn,
  idleBiasRunning,
  manualConfig,
  manualForceConfig,
  ok,
  okIdle,
  pdDiagnostics,
  withThermal,
} from "./DevicePowerPanelStoryFixtures";

const meta: Meta<typeof DevicePowerPanel> = {
  title: "Panels/DevicePowerPanel",
  component: DevicePowerPanel,
  tags: ["autodocs", "two-stage-hold"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="min-h-screen bg-[var(--bg)] p-6">
          <div className="mx-auto max-w-[1280px]">
            <Story />
          </div>
        </div>
      </ToastProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof DevicePowerPanel>;

function thermalStoryArgs(
  thermal: PdDiagnosticsResponse["thermal"],
  overrides: Partial<Story["args"]> = {},
): Story["args"] {
  return {
    ...defaultArgs,
    sharedPdDiagnostics: withThermal(thermal),
    loadPdDiagnostics: () =>
      Promise.resolve({
        ok: true,
        value: withThermal(thermal),
      }),
    ...overrides,
  };
}

export const Default: Story = {
  args: {
    ...defaultArgs,
    canControlHardware: false,
    coordination: {
      role: "unsupported",
      currentTabId: "tab-a",
      leaderTabId: null,
      leaseExpiresAt: null,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Unlocked")).toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "Acquire control" }),
    ).toBeVisible();
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
    await expect(
      await canvas.findByRole("button", { name: "Fixed PDO 9V" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeDisabled();
  },
};

export const ControlledHere: Story = {
  args: {
    ...defaultArgs,
    sharedRevision: 1,
    sharedPowerConfig: controlledHereConfig,
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setPowerLock: () => ok(controlledHereConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Controlled here")).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Acquire control" }),
    ).not.toBeInTheDocument();
  },
};

export const QueuedMutation: Story = {
  args: {
    ...defaultArgs,
    sharedRevision: 2,
    sharedPowerConfig: controlledHereConfig,
    sharedCommand: {
      requestId: "cmd-1",
      deviceId: "bench-hub",
      sourceTabId: "tab-b",
      kind: "mutation",
      method: "savePowerConfig",
      state: "queued",
      queuedAt: new Date(Date.now() - 400).toISOString(),
      startedAt: null,
      finishedAt: null,
      revision: 2,
      errorMessage: null,
    },
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const powerCapInput = await canvas.findByDisplayValue("100 W");
    await userEvent.clear(powerCapInput);
    await userEvent.type(powerCapInput, "83 W");
    await expect(canvas.getByRole("slider", { name: /Voltage/ })).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeDisabled();
  },
};

export const RunningSharedSave: Story = {
  args: {
    ...defaultArgs,
    sharedRevision: 2,
    sharedPowerConfig: controlledHereConfig,
    sharedCommand: {
      requestId: "cmd-2",
      deviceId: "bench-hub",
      sourceTabId: "tab-a",
      kind: "mutation",
      method: "savePowerConfig",
      state: "running",
      queuedAt: new Date(Date.now() - 6_500).toISOString(),
      startedAt: new Date(Date.now() - 6_000).toISOString(),
      finishedAt: null,
      revision: 2,
      errorMessage: null,
    },
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("slider", { name: /Voltage/ }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeDisabled();
  },
};

export const StaleDraftAfterRemoteWrite: Story = {
  render: (args) => {
    const [revision, setRevision] = useState(3);
    const [sharedConfig, setSharedConfig] = useState(controlledHereConfig);
    return (
      <div className="grid gap-4">
        <button
          className="w-fit rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12px] font-bold text-[var(--text)]"
          type="button"
          onClick={() => {
            setSharedConfig({
              ...controlledHereConfig,
              manual: {
                ...controlledHereConfig.manual,
                voltage_mv: 12000,
              },
            });
            setRevision((current) => current + 1);
          }}
        >
          Simulate remote update
        </button>
        <DevicePowerPanel
          {...args}
          sharedPowerConfig={sharedConfig}
          sharedRevision={revision}
          loadPowerConfig={() => ok(sharedConfig)}
        />
      </div>
    );
  },
  args: {
    ...defaultArgs,
    sharedPowerConfig: controlledHereConfig,
    sharedRevision: 3,
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const voltageInput = await canvas.findByDisplayValue("9 V");
    await userEvent.clear(voltageInput);
    await userEvent.type(voltageInput, "15 V");
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeEnabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Simulate remote update" }),
    );
    await expect(await canvas.findByDisplayValue("15 V")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeDisabled();
  },
};

export const LockedByAnotherHost: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () => ok(hostLockedConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setPowerLock: () => apiError("Power settings are locked by another host"),
    transportLabel: "http",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Locked by another host"),
    ).toBeVisible();
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
    sharedRevision: 1,
    sharedPowerConfig: controlledAutoConfig,
    loadPowerConfig: () => ok(controlledAutoConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    savePowerConfig: () => ok(controlledAutoConfig),
    setPowerLock: () => ok(controlledAutoConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByLabelText("Auto-follow cable loop compensation help"),
    );
    const popover = within(document.body);
    await userEvent.type(
      popover.getByLabelText(
        "Auto-follow cable loop compensation voltage drop",
      ),
      "300",
    );
    await userEvent.clear(
      popover.getByLabelText(
        "Auto-follow cable loop compensation load current",
      ),
    );
    await userEvent.type(
      popover.getByLabelText(
        "Auto-follow cable loop compensation load current",
      ),
      "3000",
    );
    await expect(
      canvas.getByRole("slider", {
        name: "Auto-follow cable loop compensation",
      }),
    ).toHaveValue("3");
  },
};

export const ManualTpsCdcSet: Story = {
  args: {
    ...defaultArgs,
    loadPowerConfig: () =>
      ok({
        ...controlledHereConfig,
        manual: {
          ...manualConfig.manual,
          tps_cdc_rise_mv: 700,
        },
      }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByLabelText("Manual cable loop compensation help"),
    );
    const popover = within(document.body);
    await userEvent.clear(
      popover.getByLabelText("Manual cable loop compensation voltage drop"),
    );
    await userEvent.type(
      popover.getByLabelText("Manual cable loop compensation voltage drop"),
      "300",
    );
    await userEvent.clear(
      popover.getByLabelText("Manual cable loop compensation load current"),
    );
    await userEvent.type(
      popover.getByLabelText("Manual cable loop compensation load current"),
      "3000",
    );
    await expect(
      canvas.getByRole("slider", { name: "Cable loop compensation" }),
    ).toHaveValue("5");
  },
};

export const OutputOffManualHighVoltage: Story = {
  args: {
    ...defaultArgs,
    sharedRevision: 1,
    sharedPowerConfig: controlledManualOutputOffConfig,
    loadPowerConfig: () => ok(controlledManualOutputOffConfig),
    savePowerConfig: () => ok(controlledManualOutputOffConfig),
    setPowerLock: () => ok(controlledManualOutputOffConfig),
    setPowerRuntime: () => ok(controlledManualOutputOffConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("usb-c-power-state"),
    ).toHaveAccessibleName("Power off");
    await expect(
      await canvas.findByTestId("runtime-output-toggle"),
    ).toHaveTextContent("Power");
    await expect(
      await canvas.findByTestId("runtime-discharge-toggle"),
    ).toHaveTextContent("Enabled");
    await expect(
      await canvas.findByTestId("runtime-discharge-toggle"),
    ).toBeEnabled();
    await expect(await canvas.findByTestId("usb-c-voltage")).toHaveTextContent(
      "20.060V",
    );
    await expect(await canvas.findByTestId("usb-c-voltage-value")).toHaveClass(
      "text-[var(--telemetry-voltage)]",
    );
    await expect(await canvas.findByTestId("usb-c-voltage-unit")).toHaveClass(
      "text-[var(--telemetry-voltage)]",
    );
    await expect(await canvas.findByTestId("usb-c-current")).toHaveTextContent(
      "0.030A",
    );
    await expect(await canvas.findByTestId("usb-c-current-value")).toHaveClass(
      "text-[var(--telemetry-current)]",
    );
    await expect(await canvas.findByTestId("usb-c-current-unit")).toHaveClass(
      "text-[var(--telemetry-current)]",
    );
    await expect(await canvas.findByTestId("usb-c-power")).toHaveTextContent(
      "0.540W",
    );
    await expect(await canvas.findByTestId("usb-c-power-value")).toHaveClass(
      "text-[var(--telemetry-power)]",
    );
    await expect(await canvas.findByTestId("usb-c-power-unit")).toHaveClass(
      "text-[var(--telemetry-power)]",
    );
  },
};

export const ThermalNormal: Story = {
  args: {
    ...thermalStoryArgs({
      ...pdDiagnostics.thermal,
      state: "normal",
      reason: "none",
      effective_power_watts: 100,
    }),
  },
};

export const ThermalDerating: Story = {
  args: {
    ...thermalStoryArgs({
      ...pdDiagnostics.thermal,
      sensors: {
        mcu: { temperature_deci_c: 789, status: "ok" },
        tmp112: { temperature_deci_c: 851, status: "ok" },
      },
      hottest_temperature_deci_c: 851,
      state: "derating",
      reason: "tmp112_hot",
      effective_power_watts: 75,
    }),
  },
};

export const ThermalShutdown: Story = {
  args: {
    ...thermalStoryArgs(
      {
        ...pdDiagnostics.thermal,
        sensors: {
          mcu: { temperature_deci_c: 1008, status: "ok" },
          tmp112: { temperature_deci_c: 984, status: "ok" },
        },
        hottest_temperature_deci_c: 1008,
        state: "shutdown",
        reason: "mcu_critical",
        effective_power_watts: 0,
      },
      {
        sharedPowerConfig: controlledManualOutputOffConfig,
        loadPowerConfig: () => ok(controlledManualOutputOffConfig),
      },
    ),
  },
};

export const ThermalRearmRequired: Story = {
  args: {
    ...thermalStoryArgs(
      {
        ...pdDiagnostics.thermal,
        sensors: {
          mcu: { temperature_deci_c: 941, status: "ok" },
          tmp112: { temperature_deci_c: 965, status: "ok" },
        },
        hottest_temperature_deci_c: 965,
        state: "rearm_required",
        reason: "none",
        effective_power_watts: 0,
      },
      {
        sharedPowerConfig: controlledManualOutputOffConfig,
        loadPowerConfig: () => ok(controlledManualOutputOffConfig),
      },
    ),
  },
};

export const ThermalSensorFault: Story = {
  args: {
    ...thermalStoryArgs(
      {
        ...pdDiagnostics.thermal,
        sensors: {
          mcu: { temperature_deci_c: 512, status: "stale" },
          tmp112: { temperature_deci_c: null, status: "error" },
        },
        hottest_temperature_deci_c: 512,
        state: "sensor_fault",
        reason: "tmp112_sensor_fault",
        effective_power_watts: 0,
      },
      {
        sharedPowerConfig: controlledManualOutputOffConfig,
        loadPowerConfig: () => ok(controlledManualOutputOffConfig),
      },
    ),
  },
};

export const TelemetryTonesDark: Story = {
  decorators: [
    (Story) => (
      <div data-theme="isolapurr-dark">
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
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
    const popover = within(document.body);
    await expect(
      await popover.findByText(/PFM follows the board default/i),
    ).toBeVisible();
  },
};

export const LocalDraftSaveAction: Story = {
  render: (args) => {
    const [saved, setSaved] = useState(false);
    return (
      <div className="grid gap-4">
        {saved ? (
          <div
            className="text-[12px] font-semibold text-[var(--badge-success-text)]"
            data-testid="save-invoked"
          >
            Save invoked
          </div>
        ) : null}
        <DevicePowerPanel
          {...args}
          savePowerConfig={async (input) => {
            setSaved(true);
            return ok({
              ...controlledHereConfig,
              tps_mode: input.tps_mode,
              manual: {
                ...controlledHereConfig.manual,
                ...input.manual,
              },
            });
          }}
        />
      </div>
    );
  },
  args: {
    ...defaultArgs,
    sharedRevision: 1,
    sharedPowerConfig: controlledHereConfig,
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setPowerLock: () => ok(controlledHereConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const voltageInput = await canvas.findByDisplayValue("9 V");
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeDisabled();
    await userEvent.clear(voltageInput);
    await userEvent.type(voltageInput, "12 V");
    await expect(await canvas.findByDisplayValue("12 V")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save and apply" }),
    ).toBeEnabled();
    await expect(canvas.queryByTestId("save-invoked")).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Save and apply" }),
    );
    await expect(await canvas.findByTestId("save-invoked")).toBeVisible();
  },
};

export const RestoreDefaultsFlow: Story = {
  args: {
    ...defaultArgs,
    sharedRevision: 1,
    sharedPowerConfig: controlledHereConfig,
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    restorePowerDefaults: () => ok(controlledAutoConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Restore defaults" }),
    );
    await expect(await canvas.findByDisplayValue("5 V")).toBeVisible();
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
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Run calibration" }),
    );
    await expect(
      await page.findByRole("alertdialog", {
        name: "Run USB-C idle-bias calibration?",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/Disconnect every USB-C device first/),
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
