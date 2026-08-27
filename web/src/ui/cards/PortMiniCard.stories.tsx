import type { Meta, StoryObj } from "@storybook/react";
import { expect } from "@storybook/test";
import { useLayoutEffect, useState } from "react";

import { PortMiniCard } from "./PortMiniCard";

const meta: Meta<typeof PortMiniCard> = {
  title: "Cards/PortMiniCard",
  component: PortMiniCard,
  tags: ["autodocs", "two-stage-hold"],
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
    onSetPower: async () => ({ ok: true }),
    onSetData: async () => ({ ok: true }),
  },
};

export default meta;
type Story = StoryObj<typeof PortMiniCard>;

export const Precision: Story = {};

export const ActionLabelsVisible: Story = {
  play: async ({ canvasElement }) => {
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

export const RepluggingKeepsConfirmedState: Story = {
  args: {
    state: {
      power_enabled: true,
      data_connected: false,
      replugging: true,
      busy: true,
    },
  },
  render: (args) => {
    const [state, setState] = useState({
      ...args.state,
      data_connected: true,
      replugging: false,
      busy: false,
    });
    useLayoutEffect(() => {
      setState(args.state);
    }, [args.state]);
    return <PortMiniCard {...args} state={state} />;
  },
  play: async ({ canvasElement }) => {
    const dataButton = canvasElement.querySelectorAll("button")[1];
    await expect(dataButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      dataButton.querySelector(".two-stage-hold__feedback"),
    ).toHaveAccessibleName("Data link connected");
  },
};
