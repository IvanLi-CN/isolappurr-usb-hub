import type { Meta, StoryObj } from "@storybook/react";

import { PortMiniCard } from "./PortMiniCard";

const meta: Meta<typeof PortMiniCard> = {
  title: "Cards/PortMiniCard",
  component: PortMiniCard,
  tags: ["autodocs"],
  args: {
    portId: "port_c",
    label: "USB-C",
    telemetry: {
      status: "ok",
      voltage_mv: 9030,
      current_ma: 470,
      power_mw: 4280,
      sample_uptime_ms: 123_456,
    },
    state: {
      power_enabled: true,
      data_connected: true,
      replugging: false,
      busy: false,
    },
    disabled: false,
    onSetPower: () => {},
    onReplug: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PortMiniCard>;

export const Precision: Story = {};

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
