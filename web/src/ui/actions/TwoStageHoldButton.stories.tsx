import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, within } from "@storybook/test";
import { useState } from "react";

import { TwoStageHoldButton } from "./TwoStageHoldButton";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function HoldDemo({
  initial = true,
  disabled = false,
  unavailableReason,
}: {
  initial?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
}) {
  const [value, setValue] = useState(initial);
  const [events, setEvents] = useState<string[]>([]);

  return (
    <div className="min-h-32 bg-[var(--bg)] p-6 text-[var(--text)]">
      <TwoStageHoldButton
        className="w-[148px]"
        disabled={disabled}
        label="Data link"
        testId="two-stage-hold"
        unavailableReason={unavailableReason}
        value={value}
        onSetValue={async (next) => {
          setValue(next);
          setEvents((current) => [...current, String(next)]);
          return { ok: true };
        }}
      />
      <div className="mt-5 font-mono text-[12px]" data-testid="hold-events">
        {events.join(",") || "none"}
      </div>
    </div>
  );
}

const meta: Meta<typeof TwoStageHoldButton> = {
  title: "Actions/TwoStageHoldButton",
  component: TwoStageHoldButton,
  tags: ["autodocs", "two-stage-hold"],
};

export default meta;
type Story = StoryObj<typeof TwoStageHoldButton>;

export const Default: Story = {
  render: () => <HoldDemo />,
};

export const EarlyReleaseGuidance: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    await sleep(180);
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    await expect(await canvas.findByRole("tooltip")).toHaveTextContent(
      /continue holding about 0.6s/i,
    );
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent("none");
  },
};

export const StageOneThenRestore: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    await sleep(1320);
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent(
      "false,true",
    );
  },
};

export const KeyboardStageOne: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    button.focus();
    fireEvent.keyDown(button, { key: " " });
    await sleep(720);
    fireEvent.keyUp(button, { key: " " });
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent("false");
  },
};

export const TouchStageOne: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.pointerDown(button, {
      button: 0,
      pointerId: 2,
      pointerType: "touch",
    });
    await sleep(720);
    fireEvent.pointerUp(button, {
      button: 0,
      pointerId: 2,
      pointerType: "touch",
    });
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent("false");
  },
};

export const UsageTooltip: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.mouseOver(button);
    await sleep(520);
    const tooltip = await canvas.findByRole("tooltip");
    await expect(tooltip).toHaveAttribute("data-visible", "true");
    await expect(tooltip).toHaveTextContent(/hold 0.6s to disable data link/i);
  },
};

export const UnavailableTooltip: Story = {
  render: () => (
    <HoldDemo
      disabled
      unavailableReason="This firmware does not support the Data link control. Update the device firmware to use it."
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.click(button);
    await expect(await canvas.findByRole("tooltip")).toHaveTextContent(
      /update the device firmware/i,
    );
  },
};
