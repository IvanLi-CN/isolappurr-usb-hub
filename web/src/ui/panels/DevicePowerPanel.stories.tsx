import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";

import type { PowerConfigResponse, Result } from "../../domain/deviceApi";
import { DevicePowerPanel } from "./DevicePowerPanel";

const manualConfig: PowerConfigResponse = {
  hardware: "sw2303",
  persisted: true,
  tps_mode: "manual",
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

const hostLockedConfig: PowerConfigResponse = {
  ...manualConfig,
  lock: { owner: 42, expires_at_ms: Date.now() + 15_000 },
};

const ok = (value: PowerConfigResponse): Promise<Result<PowerConfigResponse>> =>
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

export const Default: Story = {
  args: {
    deviceKey: "bench-hub",
    deviceName: "Bench Hub",
    transportLabel: "local_usb",
    localAdvancedLocked: false,
    loadPowerConfig: () => ok(manualConfig),
    savePowerConfig: () => ok(manualConfig),
    restorePowerDefaults: () => ok(autoConfig),
    setPowerLock: () => ok(manualConfig),
  },
};

export const HostLocked: Story = {
  args: {
    ...Default.args,
    loadPowerConfig: () => ok(hostLockedConfig),
    setPowerLock: () => apiError("Power settings are locked by another host"),
    transportLabel: "http",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Host lock active")).toBeVisible();
    await expect(
      canvas.getByRole("slider", { name: /Voltage/ }),
    ).toBeDisabled();
  },
};

export const AutoFollowDefaults: Story = {
  args: {
    ...Default.args,
    loadPowerConfig: () => ok(autoConfig),
    savePowerConfig: () => ok(autoConfig),
    setPowerLock: () => ok(autoConfig),
  },
};

export const SaveManualFlow: Story = {
  args: {
    ...Default.args,
    loadPowerConfig: () => ok(autoConfig),
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
    ...Default.args,
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

export const ApiFailure: Story = {
  args: {
    ...Default.args,
    loadPowerConfig: () => apiError("EEPROM U21 write failed"),
  },
};

export const Narrow: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrNarrow" },
  },
  args: {
    ...Default.args,
  },
};
