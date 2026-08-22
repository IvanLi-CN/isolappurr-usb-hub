import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import type { PowerConfigResponse } from "../../domain/deviceApi";
import { ToastProvider } from "../toast/ToastProvider";
import { DevicePowerPanel } from "./DevicePowerPanel";
import {
  controlledHereConfig,
  defaultArgs,
  idleBiasReadyOff,
  ok,
  okIdle,
} from "./DevicePowerPanelStoryFixtures";

const meta = {
  title: "Panels/DevicePowerPanel",
  component: DevicePowerPanel,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story: React.ComponentType) => (
      <ToastProvider>
        <div className="min-h-screen bg-[var(--bg)] p-6">
          <div className="mx-auto max-w-[1280px]">
            <Story />
          </div>
        </div>
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof DevicePowerPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ProtocolInlineControls: Story = {
  render: (args) => {
    const [savedConfig, setSavedConfig] = useState(controlledHereConfig);
    return (
      <DevicePowerPanel
        {...args}
        sharedPowerConfig={savedConfig}
        loadPowerConfig={() => ok(savedConfig)}
        savePowerConfig={async (input) => {
          const nextConfig: PowerConfigResponse = {
            ...savedConfig,
            capability: input.capability,
            light_load_mode: input.light_load_mode,
            manual: {
              ...savedConfig.manual,
              ...input.manual,
            },
            sw2303_line_compensation: input.sw2303_line_compensation,
            tps_mode: input.tps_mode,
          };
          setSavedConfig(nextConfig);
          return ok(nextConfig);
        }}
      />
    );
  },
  args: {
    ...defaultArgs,
    sharedRevision: 1,
    sharedPowerConfig: controlledHereConfig,
    loadPowerConfig: () => ok(controlledHereConfig),
    loadIdleBias: () => okIdle(idleBiasReadyOff),
    setPowerLock: () => ok(controlledHereConfig),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Controlled here")).toBeVisible();

    const fixedPdo = await canvas.findByRole("button", {
      name: "Fixed PDO 9V",
    });
    await expect(fixedPdo).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(fixedPdo);
    await expect(fixedPdo).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();

    const qc2 = canvasElement.querySelector<HTMLElement>(
      '[data-protocol="qc20"]',
    );
    if (!qc2) {
      throw new Error("QC2 protocol card not found");
    }
    const qc2Card = within(qc2);
    const qc2Header = qc2Card.getByRole("button", { name: /QC2/ });
    await userEvent.click(qc2Header);
    await expect(qc2Header).toHaveAttribute("aria-pressed", "false");
    const qc2Toggle = qc2Card.getByRole("button", { name: "20V profile" });
    await expect(qc2Toggle).toBeEnabled();
    await userEvent.click(qc2Toggle);
    await expect(qc2Toggle).toHaveAttribute("aria-pressed", "false");

    const fcp = canvasElement.querySelector<HTMLElement>(
      '[data-protocol="fcp"]',
    );
    const afc = canvasElement.querySelector<HTMLElement>(
      '[data-protocol="afc"]',
    );
    const sfcp = canvasElement.querySelector<HTMLElement>(
      '[data-protocol="sfcp"]',
    );
    if (!fcp || !afc || !sfcp) {
      throw new Error("shared fast-protocol cards not found");
    }

    const fcpCard = within(fcp);
    const afcCard = within(afc);
    const sfcpCard = within(sfcp);
    await userEvent.click(fcpCard.getByText("2.25A"));
    await expect(afcCard.getByRole("radio", { name: "2.25A" })).toBeChecked();
    await expect(sfcpCard.getByRole("radio", { name: "2.25A" })).toBeChecked();

    const fcp12v = fcpCard.getByRole("button", { name: "12V profile" });
    await userEvent.click(fcp12v);
    await expect(
      afcCard.getByRole("button", { name: "12V profile" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      sfcpCard.getByRole("button", { name: "12V profile" }),
    ).toHaveAttribute("aria-pressed", "false");

    const indicator = canvasElement.querySelector<HTMLElement>(
      ".protocol-inline-choice-indicator",
    );
    if (!indicator) {
      throw new Error("sliding choice indicator not found");
    }
    expect(indicator.style.transform).toContain("translate3d");
  },
};

export const Narrow: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrNarrow" },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[390px]" data-protocol-narrow>
        <style>{`
          [data-protocol-narrow] .protocol-grid {
            grid-template-columns: 1fr;
          }
        `}</style>
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("PD");
    await expect(
      await canvas.findByRole("button", { name: "Fixed PDO 9V" }),
    ).toBeVisible();

    const actionLabels = canvasElement.querySelectorAll(
      ".two-stage-hold__label",
    );
    await expect(actionLabels).toHaveLength(2);
    await expect(actionLabels[0]).toHaveTextContent("Power");
    await expect(actionLabels[1]).toHaveTextContent("Data link");
    for (const label of actionLabels) {
      await expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      const feedback = label
        .closest("button")
        ?.querySelector<HTMLElement>(".two-stage-hold__feedback");
      await expect(feedback?.textContent?.trim()).toBe("");
      await expect(
        feedback?.querySelectorAll(".two-stage-hold__status-icon"),
      ).toHaveLength(1);
    }

    const cards = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".protocol-card"),
    );
    await expect(
      new Set(
        cards.map((card) => Math.round(card.getBoundingClientRect().height)),
      ).size,
    ).toBe(1);
    await expect(
      Math.round(cards[0]?.getBoundingClientRect().height ?? 0),
    ).toBe(112);
    for (const card of cards) {
      await expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight);
    }
    const controls = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        ".protocol-inline-chip, .protocol-inline-choice-group, .protocol-inline-toggle",
      ),
    );
    await expect(
      new Set(
        controls.map((control) =>
          Math.round(control.getBoundingClientRect().height),
        ),
      ).size,
    ).toBe(1);
    await expect(
      Math.round(controls[0]?.getBoundingClientRect().height ?? 0),
    ).toBe(36);
  },
};

export const MediumWideCards: Story = {
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[720px]" data-medium-wide-cards>
        <style>{`
          [data-medium-wide-cards] .protocol-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        `}</style>
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("PD-negotiation-badge"),
    ).toBeVisible();
    await expect(canvas.getByTestId("QC2-negotiation-badge")).toBeVisible();
  },
};

export const CompactDesktopCards: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrLaptop" },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[800px]">
        <Story />
      </div>
    ),
  ],
  args: {
    ...defaultArgs,
    loadIdleBias: () => okIdle(idleBiasReadyOff),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("PD");
    const cards = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(".protocol-card"),
    );
    const firstRowTop = Math.min(
      ...cards.map((card) => card.getBoundingClientRect().top),
    );
    const firstRow = cards.filter(
      (card) =>
        Math.round(card.getBoundingClientRect().top) ===
        Math.round(firstRowTop),
    );

    await expect(firstRow).toHaveLength(4);
    await expect(
      new Set(
        cards.map((card) => Math.round(card.getBoundingClientRect().height)),
      ).size,
    ).toBe(1);
    await expect(
      Math.round(cards[0]?.getBoundingClientRect().height ?? 0),
    ).toBe(104);
    const controls = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        ".protocol-inline-chip, .protocol-inline-choice-group, .protocol-inline-toggle",
      ),
    );
    await expect(
      new Set(
        controls.map((control) =>
          Math.round(control.getBoundingClientRect().height),
        ),
      ).size,
    ).toBe(1);
    await expect(
      Math.round(controls[0]?.getBoundingClientRect().height ?? 0),
    ).toBe(28);
  },
};
