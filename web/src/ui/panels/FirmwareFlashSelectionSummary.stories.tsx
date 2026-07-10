import type { Meta, StoryObj } from "@storybook/react";

import { FirmwareFlashSelectionSummary } from "./FirmwareFlashSelectionSummary";

const meta: Meta<typeof FirmwareFlashSelectionSummary> = {
  title: "Panels/FirmwareFlashSelectionSummary",
  component: FirmwareFlashSelectionSummary,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="w-[320px] rounded-[16px] border border-[var(--border)] bg-[var(--panel)] px-5 pb-5">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof FirmwareFlashSelectionSummary>;

export const VersionChange: Story = {
  args: {
    items: [
      { label: "transport", value: "Web Serial" },
      { label: "mode", value: "Normal update" },
      { label: "source", value: "Bundled release" },
      { label: "installed", value: "0.5.0" },
      { label: "to flash", value: "0.5.1" },
      { label: "confirm", value: "Confirm" },
      { label: "address", value: "0x10000", mono: true },
    ],
  },
};

export const WaitingForDevice: Story = {
  args: {
    items: [
      { label: "transport", value: "Not connected" },
      { label: "mode", value: "Normal update" },
      { label: "source", value: "Bundled release" },
      { label: "installed", value: "—" },
      { label: "to flash", value: "0.5.1" },
      { label: "confirm", value: "Confirm" },
      { label: "address", value: "0x10000", mono: true },
    ],
  },
};
