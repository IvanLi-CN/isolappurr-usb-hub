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
  compact = false,
}: {
  initial?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [events, setEvents] = useState<string[]>([]);

  return (
    <div className="min-h-32 bg-[var(--bg)] p-6 text-[var(--text)]">
      <TwoStageHoldButton
        className={compact ? "w-[102px]" : "w-[148px]"}
        compact={compact}
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

function RejectingHoldDemo() {
  const [value, setValue] = useState(true);
  const [attempts, setAttempts] = useState(0);

  return (
    <div className="min-h-32 bg-[var(--bg)] p-6 text-[var(--text)]">
      <TwoStageHoldButton
        label="Data link"
        testId="rejecting-two-stage-hold"
        value={value}
        onSetValue={async (next) => {
          setAttempts((current) => current + 1);
          if (attempts === 0) {
            throw new Error("leader request timed out");
          }
          setValue(next);
          return { ok: true };
        }}
      />
      <div data-testid="hold-attempts">{attempts}</div>
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
    preview: { phase: "idle", stage: "result", tone: "neutral" },
  },
  {
    title: "Disconnected",
    status: "Data link is stopped",
    value: false,
    preview: { phase: "idle", stage: "result", tone: "neutral" },
  },
  {
    title: "Holding",
    status: "Continue to 0.6s",
    value: true,
    preview: {
      phase: "holding",
      holdProgress: 0.52,
      stage: "first",
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
      holdProgress: 1,
      stage: "first",
      tone: "warning",
      message: "Confirming Disable data link...",
    },
  },
  {
    title: "Change applied",
    status: "Disabled; keep holding to restore",
    value: false,
    preview: {
      phase: "stage-one",
      restoreProgress: 0,
      stage: "first-complete",
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
      restoreProgress: 0.58,
      stage: "second",
      tone: "warning",
      message: "Confirming Enable data link...",
    },
  },
  {
    title: "Restored",
    status: "Original state resumed",
    value: true,
    preview: {
      phase: "confirmed",
      stage: "result",
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
      stage: "result",
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
      stage: "first",
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
      stage: "result",
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
    preview: { phase: "idle", stage: "result", tone: "neutral" },
  },
];

function StateMatrix({ compact = false }: { compact?: boolean }) {
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
                  className={compact ? "w-[102px]" : "w-full"}
                  compact={compact}
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const state = await canvas.findByRole("img", {
      name: "Data link connected",
    });
    await expect(state).toBeVisible();
    await expect(
      state.querySelector('[data-status-icon="data-linked"]'),
    ).not.toBeNull();
  },
};

export const AllStates: Story = {
  render: () => <StateMatrix />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button")).toHaveLength(stateCards.length);
    await expect(canvas.getByText("Restore pending")).toBeInTheDocument();
    await expect(canvas.getByText("Changed elsewhere")).toBeInTheDocument();
    const restoreControl = canvasElement.querySelector(
      'section[aria-label^="Restore pending"] .two-stage-hold',
    );
    await expect(restoreControl).toHaveAttribute(
      "data-progress-direction",
      "reverse",
    );
    await expect(restoreControl).toHaveAttribute("data-tone", "warning");
    const stageOneButton = canvasElement.querySelector<HTMLButtonElement>(
      'section[aria-label^="Change applied"] .two-stage-hold__button',
    );
    const restoredButton = canvasElement.querySelector<HTMLButtonElement>(
      'section[aria-label^="Restored"] .two-stage-hold__button',
    );
    const failedButton = canvasElement.querySelector<HTMLButtonElement>(
      'section[aria-label^="Request failed"] .two-stage-hold__button',
    );
    if (!stageOneButton || !restoredButton || !failedButton) {
      throw new Error("Expected the hold feedback state buttons to render.");
    }
    await expect(
      window.getComputedStyle(stageOneButton).animationName,
    ).toContain("two-stage-hold-stage-one-success");
    await expect(
      window.getComputedStyle(restoredButton).animationName,
    ).toContain("two-stage-hold-stage-two-success");
    await expect(window.getComputedStyle(failedButton).animationName).toContain(
      "two-stage-hold-failure-button",
    );
    const unavailableControl = canvasElement.querySelector(
      'section[aria-label^="Update required"] .two-stage-hold',
    );
    await expect(unavailableControl).toHaveAttribute("data-tone", "neutral");
    await expect(unavailableControl?.querySelector("button")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const controls = canvasElement.querySelectorAll(".two-stage-hold");
    await expect(controls).toHaveLength(stateCards.length);
    for (const control of controls) {
      const label = control.querySelector<HTMLElement>(
        ".two-stage-hold__label",
      );
      const feedback = control.querySelector<HTMLElement>(
        ".two-stage-hold__feedback",
      );
      if (!label || !feedback) {
        throw new Error(
          "Expected every hold control to render a label and state icon.",
        );
      }
      await expect(label).toHaveTextContent("Data link");
      await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      await expect(window.getComputedStyle(label).textOverflow).toBe("clip");
      await expect(feedback.textContent?.trim()).toBe("");
      await expect(
        feedback.querySelectorAll(".two-stage-hold__status-icon"),
      ).toHaveLength(1);
    }
  },
};

export const AllStatesMobile: Story = {
  render: () => <StateMatrix />,
  parameters: {
    viewport: { defaultViewport: "mobile393" },
  },
};

export const CompactAllStates: Story = {
  render: () => <StateMatrix compact />,
  play: async ({ canvasElement }) => {
    const feedbacks = canvasElement.querySelectorAll(
      ".two-stage-hold__feedback",
    );
    await expect(feedbacks).toHaveLength(stateCards.length);
    for (const feedback of feedbacks) {
      await expect(feedback.scrollWidth).toBeLessThanOrEqual(
        feedback.clientWidth,
      );
    }
    const icons = canvasElement.querySelectorAll(
      ".two-stage-hold__status-icon",
    );
    await expect(icons).toHaveLength(stateCards.length);
    const buttons = canvasElement.querySelectorAll<HTMLButtonElement>(
      ".two-stage-hold--compact .two-stage-hold__button",
    );
    for (const button of buttons) {
      const label = button.querySelector<HTMLElement>(".two-stage-hold__label");
      const icon = button.querySelector<HTMLElement>(
        ".two-stage-hold__status-icon",
      );
      if (!label || !icon) {
        throw new Error("Expected compact control label and status icon.");
      }
      await expect(label).toHaveTextContent("Data link");
      await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      await expect(window.getComputedStyle(label).textOverflow).toBe("clip");
      await expect(
        button.querySelector(".two-stage-hold__feedback")?.textContent?.trim(),
      ).toBe("");
      const labelBox = label.getBoundingClientRect();
      const iconBox = icon.getBoundingClientRect();
      await expect(
        Math.abs(
          labelBox.y + labelBox.height / 2 - (iconBox.y + iconBox.height / 2),
        ),
      ).toBeLessThanOrEqual(2);
    }
    const unavailableButton = canvasElement.querySelector<HTMLButtonElement>(
      'section[aria-label^="Update required"] .two-stage-hold__button',
    );
    const unavailableFeedback = unavailableButton?.querySelector<HTMLElement>(
      ".two-stage-hold__feedback",
    );
    if (!unavailableButton || !unavailableFeedback) {
      throw new Error("Expected the unavailable compact control to render.");
    }
    await expect(window.getComputedStyle(unavailableFeedback).color).toBe(
      window.getComputedStyle(unavailableButton).color,
    );
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
    await expect(button.parentElement).toHaveAttribute("data-phase", "hint");
    await expect(window.getComputedStyle(button).animationName).toContain(
      "two-stage-hold-hint-reject",
    );
    await expect(
      button.parentElement
        ?.querySelector(".two-stage-hold__feedback")
        ?.textContent?.trim(),
    ).toBe("");
    await expect(
      button.parentElement?.querySelector(
        ".two-stage-hold__feedback .two-stage-hold__status-icon",
      ),
    ).not.toBeNull();
    await expect(
      button.parentElement?.querySelector("[aria-live]"),
    ).toHaveTextContent(/continue holding about 0\.6s/i);
    await expect(canvas.getByRole("tooltip", { hidden: true })).toHaveAttribute(
      "data-visible",
      "false",
    );
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent("none");
    fireEvent.click(button);
    const tooltip = await canvas.findByRole("tooltip");
    await expect(tooltip).toHaveAttribute("data-visible", "true");
  },
};

export const CompactEarlyReleaseGuidance: Story = {
  render: () => <HoldDemo compact />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    await sleep(180);
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    await expect(
      await canvas.findByRole("img", { name: "Data link connected" }),
    ).toBeInTheDocument();
    const feedback = canvasElement.querySelector(".two-stage-hold__feedback");
    if (!feedback) {
      throw new Error("Expected compact hold feedback to render.");
    }
    await expect(feedback.scrollWidth).toBeLessThanOrEqual(
      feedback.clientWidth,
    );
    await expect(
      feedback.querySelector('[data-status-icon="data-linked"]'),
    ).not.toBeNull();
  },
};

export const StageOneThenRestore: Story = {
  render: () => <HoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("two-stage-hold");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    await sleep(720);
    await expect(button.parentElement).toHaveAttribute(
      "data-stage",
      "first-complete",
    );
    await expect(button.parentElement).toHaveAttribute(
      "data-phase",
      "stage-one",
    );
    await expect(button.parentElement).toHaveAttribute(
      "data-progress-direction",
      "reverse",
    );
    await expect(
      button.parentElement?.querySelector('[data-status-icon="data-unlinked"]'),
    ).not.toBeNull();
    await expect(
      button.parentElement
        ?.querySelector(".two-stage-hold__feedback")
        ?.textContent?.trim(),
    ).toBe("");
    await expect(
      button.parentElement?.querySelector(".two-stage-hold__rail"),
    ).toBeNull();
    await expect(
      button.parentElement?.querySelector(".two-stage-hold__restore-progress"),
    ).toBeNull();
    await expect(canvas.getByRole("tooltip", { hidden: true })).toHaveAttribute(
      "data-visible",
      "false",
    );
    await sleep(600);
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    await expect(canvas.getByTestId("hold-events")).toHaveTextContent(
      "false,true",
    );
    await expect(button.parentElement).toHaveAttribute(
      "data-success-stage",
      "second",
    );
    await expect(
      button.parentElement?.querySelector('[data-status-icon="data-linked"]'),
    ).not.toBeNull();
    await expect(
      button.parentElement?.querySelector("[aria-live]"),
    ).toHaveTextContent(/data link restored/i);
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
    await expect(button.parentElement).toHaveAttribute(
      "data-success-stage",
      "first",
    );
    await expect(window.getComputedStyle(button).animationName).toContain(
      "two-stage-hold-stage-one-success",
    );
  },
};

export const RejectedActionRecovers: Story = {
  render: () => <RejectingHoldDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId("rejecting-two-stage-hold");
    fireEvent.pointerDown(button, { button: 0, pointerId: 1 });
    await sleep(720);
    fireEvent.pointerUp(button, { button: 0, pointerId: 1 });
    await expect(canvas.getByTestId("hold-attempts")).toHaveTextContent("1");
    await expect(button.parentElement).toHaveAttribute("data-phase", "error");

    fireEvent.pointerDown(button, { button: 0, pointerId: 2 });
    await sleep(720);
    fireEvent.pointerUp(button, { button: 0, pointerId: 2 });
    await expect(canvas.getByTestId("hold-attempts")).toHaveTextContent("2");
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
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    await expect(canvas.getByRole("tooltip", { hidden: true })).toHaveAttribute(
      "data-visible",
      "false",
    );
    fireEvent.click(button);
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
