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
    await expect(canvas.getByTestId("port-state-power")).toHaveAccessibleName(
      "Power on",
    );
    await expect(canvas.getByTestId("port-state-data")).toHaveAccessibleName(
      "Data link connected",
    );
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
    const powerState = canvas.getByTestId("port-state-power");
    const dataState = canvas.getByTestId("port-state-data");
    await expect(powerState).toHaveAccessibleName("Power off");
    await expect(dataState).toHaveAccessibleName("Data link disconnected");
    await expect(
      powerState.querySelector('[data-status-icon="power-off"]'),
    ).not.toBeNull();
    await expect(
      dataState.querySelector('[data-status-icon="data-unlinked"]'),
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
    await expect(canvas.getByTestId("port-state-data")).toHaveAccessibleName(
      "Data switching",
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
