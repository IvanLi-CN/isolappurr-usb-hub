import type { Meta, StoryObj } from "@storybook/react";

import { PortCard } from "./PortCard";

const meta: Meta<typeof PortCard> = {
  title: "Cards/PortCard",
  component: PortCard,
  tags: ["autodocs"],
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
    onTogglePower: () => {},
    onReplug: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PortCard>;

export const PowerOn: Story = {};

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
};

export const Replugging: Story = {
  args: {
    state: {
      power_enabled: true,
      data_connected: false,
      replugging: true,
      busy: true,
    },
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
