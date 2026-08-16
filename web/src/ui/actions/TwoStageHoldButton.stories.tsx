import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, within } from "@storybook/test";
import { useState } from "react";

import {
  TwoStageHoldButton,
  type TwoStageHoldPreview,
} from "./TwoStageHoldButton";

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

type StateCard = {
  title: string;
  status: string;
  value: boolean;
  preview: TwoStageHoldPreview;
  disabled?: boolean;
  unavailableReason?: string;
};

const stateCards: StateCard[] = [
  {
    title: "Connected",
    status: "Data link is active",
    value: true,
    preview: { phase: "idle", progress: 0, tone: "neutral" },
  },
  {
    title: "Disconnected",
    status: "Data link is stopped",
    value: false,
    preview: { phase: "idle", progress: 0, tone: "neutral" },
  },
  {
    title: "Holding",
    status: "Continue to 0.6s",
    value: true,
    preview: {
      phase: "holding",
      progress: 0.32,
      tone: "warning",
      message: "Hold for 0.6s to disable data link",
    },
  },
  {
    title: "Change pending",
    status: "Waiting for device confirmation",
    value: true,
    preview: {
      phase: "waiting",
      progress: 0.48,
      tone: "warning",
      message: "Confirming Disable data link...",
    },
  },
  {
    title: "Change applied",
    status: "Disabled; keep holding to restore",
    value: false,
    preview: {
      phase: "holding",
      progress: 0.58,
      tone: "warning",
      message: "Data link disabled. Keep holding to restore it.",
    },
  },
  {
    title: "Restore pending",
    status: "Waiting for original state",
    value: false,
    preview: {
      phase: "waiting",
      progress: 1,
      tone: "success",
      message: "Confirming Enable data link...",
    },
  },
  {
    title: "Restored",
    status: "Original state resumed",
    value: true,
    preview: {
      phase: "confirmed",
      progress: 1,
      tone: "success",
      message: "Data link restored",
    },
  },
  {
    title: "Released early",
    status: "No command was sent",
    value: true,
    preview: {
      phase: "hint",
      progress: 0,
      tone: "neutral",
      message: "Continue holding about 0.6s to disable data link.",
    },
  },
  {
    title: "Request failed",
    status: "No device state change",
    value: true,
    preview: {
      phase: "error",
      progress: 0.5,
      tone: "error",
      message: "Data link did not change. Try again.",
    },
  },
  {
    title: "Changed elsewhere",
    status: "Use the current device state",
    value: false,
    preview: {
      phase: "external",
      progress: 0,
      tone: "error",
      message: "Data link changed elsewhere. Hold again to act.",
    },
  },
  {
    title: "Update required",
    status: "Control is unavailable",
    value: true,
    disabled: true,
    unavailableReason:
      "This firmware does not support the Data link control. Update the device firmware to use it.",
    preview: { phase: "idle", progress: 0, tone: "neutral" },
  },
];

function StateMatrix() {
  return (
    <div className="min-h-[calc(100vh-2rem)] bg-[var(--bg)] text-[var(--text)]">
      <div
        className="mx-auto max-w-[1100px] px-4 pb-4 pt-2.5 sm:px-[21px] sm:pb-[21px] sm:pt-[15px]"
        data-testid="two-stage-hold-state-surface"
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Data link hold states</h2>
            <p className="text-xs text-[var(--muted)]">
              0.6s changes state. 1.25s restores the original state.
            </p>
          </div>
          <span className="hidden text-xs text-[var(--muted)] sm:inline">
            Device-confirmed results
          </span>
        </div>
        <div
          className="grid grid-cols-2 gap-1 sm:gap-3 lg:grid-cols-4"
          data-testid="two-stage-hold-state-matrix"
        >
          {stateCards.map((card) => (
            <section
              key={card.title}
              aria-label={`${card.title}: ${card.status}`}
              className="min-h-[108px] border border-[var(--border)] bg-[var(--panel)] p-1.5 sm:p-2"
            >
              <h3 className="text-xs font-semibold leading-4">{card.title}</h3>
              <div className="mt-0.5 sm:mt-1">
                <TwoStageHoldButton
                  className="w-full"
                  disabled={card.disabled}
                  label="Data link"
                  preview={card.preview}
                  unavailableReason={card.unavailableReason}
                  value={card.value}
                  onSetValue={async () => ({ ok: true })}
                />
              </div>
              <p className="mt-0.5 min-h-7 text-[11px] leading-[14px] text-[var(--muted)] sm:mt-1">
                {card.status}
              </p>
            </section>
          ))}
        </div>
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

export const AllStates: Story = {
  render: () => <StateMatrix />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button")).toHaveLength(stateCards.length);
    await expect(canvas.getByText("Restore pending")).toBeInTheDocument();
    await expect(canvas.getByText("Changed elsewhere")).toBeInTheDocument();
  },
};

export const AllStatesMobile: Story = {
  render: () => <StateMatrix />,
  parameters: {
    viewport: { defaultViewport: "mobile393" },
  },
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
