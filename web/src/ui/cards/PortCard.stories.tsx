import type { Meta, StoryObj } from "@storybook/react";

import { PortCard } from "./PortCard";

const meta: Meta<typeof PortCard> = {
  title: "Cards/PortCard",
  component: PortCard,
  args: {
    label: "USB-A",
    telemetry: {
      voltage_mv: 5030,
      current_ma: 820,
      power_mw: Math.round((5030 * 820) / 1000),
    },
    state: {
      power_enabled: true,
      replugging: false,
    },
    onTogglePower: () => {},
    onReplug: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PortCard>;

export const PowerOn: Story = {};

export const PowerOff: Story = {
  args: {
    state: {
      power_enabled: false,
      replugging: false,
    },
    telemetry: {
      voltage_mv: 0,
      current_ma: 0,
      power_mw: 0,
    },
  },
};

export const Replugging: Story = {
  args: {
    state: {
      power_enabled: true,
      replugging: true,
    },
  },
};
