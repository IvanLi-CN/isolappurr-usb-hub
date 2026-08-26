import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";

import { PortCard } from "./PortCard";

const meta: Meta<typeof PortCard> = {
  title: "Cards/PortCard",
  component: PortCard,
  tags: ["autodocs", "two-stage-hold"],
  args: {
    label: "USB-A",
    portId: "port_a",
    telemetry: {
      status: "ok",
      voltage_mv: 5030,
      current_ma: 820,
      power_mw: Math.round((5030 * 820) / 1000),
      sample_uptime_ms: 123_450,
    },
    state: {
      power_enabled: true,
      data_connected: true,
      replugging: false,
      busy: false,
    },
    onSetPower: async () => ({ ok: true }),
    onSetData: async () => ({ ok: true }),
  },
};

export default meta;
type Story = StoryObj<typeof PortCard>;

export const PowerOn: Story = {};

export const ActionLabelsVisible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const labels = canvasElement.querySelectorAll(".two-stage-hold__label");
    await expect(labels).toHaveLength(2);
    const expectedLabels = ["Power", "Data link"];
    for (const [index, label] of [...labels].entries()) {
      await expect(label).toHaveTextContent(expectedLabels[index]);
      await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      await expect(label.getBoundingClientRect().width).toBeGreaterThan(8);
      await expect(
        label.closest("button")?.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);
      const feedback = label
        .closest("button")
        ?.querySelector<HTMLElement>(".two-stage-hold__feedback");
      await expect(feedback?.textContent?.trim()).toBe("");
      await expect(
        feedback?.querySelectorAll(".two-stage-hold__status-icon"),
      ).toHaveLength(1);
    }
    const buttons = canvas.getAllByRole("button");
    await expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    await expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    await expect(
      buttons[0].querySelector(".two-stage-hold__feedback"),
    ).toHaveAccessibleName("Power on");
    await expect(
      buttons[1].querySelector(".two-stage-hold__feedback"),
    ).toHaveAccessibleName("Data link connected");
  },
};

export const Precision: Story = {
  args: {
    telemetry: {
      status: "ok",
      voltage_mv: 9030,
      current_ma: 470,
      power_mw: 4280,
      sample_uptime_ms: 123_456,
    },
  },
};

export const Unavailable: Story = {
  args: {
    telemetry: {
      status: "not_inserted",
      voltage_mv: null,
      current_ma: null,
      power_mw: null,
      sample_uptime_ms: 123_456,
    },
  },
};

export const UndeclaredCapability: Story = {
  args: {
    dataLinkAvailability: {
      state: "unknown",
      reason:
        "This device has not declared the Data link control capability, so it is unavailable.",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [, dataButton] = canvas.getAllByRole("button");
    await expect(dataButton).toHaveAttribute("aria-disabled", "true");
    await dataButton.click();
    await expect(await canvas.findByRole("tooltip")).toHaveTextContent(
      "This device has not declared the Data link control capability, so it is unavailable.",
    );
  },
};

export const ExplicitlyUnsupportedCapability: Story = {
  args: {
    powerAvailability: {
      state: "unsupported",
      reason: "This device does not support the Power control.",
    },
    dataLinkAvailability: {
      state: "unsupported",
      reason: "This device does not support the Data link control.",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [powerButton, dataButton] = canvas.getAllByRole("button");
    await expect(powerButton).toHaveAttribute("aria-disabled", "true");
    await expect(dataButton).toHaveAttribute("aria-disabled", "true");
    await dataButton.click();
    await expect(await canvas.findByRole("tooltip")).toHaveTextContent(
      "This device does not support the Data link control.",
    );
  },
};

export const PowerOff: Story = {
  args: {
    state: {
      power_enabled: false,
      data_connected: false,
      replugging: false,
      busy: false,
    },
    telemetry: {
      status: "ok",
      voltage_mv: 0,
      current_ma: 0,
      power_mw: 0,
      sample_uptime_ms: 123_999,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [powerButton, dataButton] = canvas.getAllByRole("button");
    await expect(powerButton).toHaveAttribute("aria-pressed", "false");
    await expect(dataButton).toHaveAttribute("aria-pressed", "false");
    await expect(
      powerButton.querySelector(".two-stage-hold__feedback"),
    ).toHaveAccessibleName("Power off");
    await expect(
      dataButton.querySelector(".two-stage-hold__feedback"),
    ).toHaveAccessibleName("Data link disconnected");
    await expect(
      powerButton.querySelector('[data-status-icon="power-off"]'),
    ).not.toBeNull();
    await expect(
      dataButton.querySelector('[data-status-icon="data-unlinked"]'),
    ).not.toBeNull();
  },
};

export const DataSwitching: Story = {
  args: {
    state: {
      power_enabled: true,
      data_connected: false,
      replugging: true,
      busy: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [, dataButton] = canvas.getAllByRole("button");
    const dataControl = dataButton.closest(".two-stage-hold");
    await expect(dataControl).toHaveAttribute("data-tone", "warning");
    await expect(dataButton).toHaveAttribute("aria-disabled", "true");
    await dataButton.click();
    await expect(await canvas.findByRole("tooltip")).toHaveTextContent(
      "Data path is switching. Wait for it to finish.",
    );
  },
};

export const Busy: Story = {
  args: {
    portId: "port_c",
    label: "USB-C",
    state: {
      power_enabled: true,
      data_connected: true,
      replugging: false,
      busy: true,
    },
  },
};

export const UsbCLiveBadges: Story = {
  args: {
    portId: "port_c",
    label: "USB-C",
    showStatusBadge: false,
    headerBadges: [
      {
        label: "3.30V",
        toneClassName:
          "border-[var(--badge-warning-bg)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
      },
      {
        label: "FOCUS",
        toneClassName:
          "border-[var(--badge-warning-bg)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]",
      },
    ],
    telemetry: {
      status: "ok",
      voltage_mv: 5011,
      current_ma: 0,
      power_mw: 3,
      sample_uptime_ms: 123_999,
    },
    state: {
      power_enabled: true,
      data_connected: false,
      replugging: false,
      busy: false,
    },
  },
};
