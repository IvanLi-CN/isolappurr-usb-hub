import type { Meta, StoryObj } from "@storybook/react";

import { FirmwareFlashTargetState } from "./FirmwareFlashTargetState";

const meta: Meta<typeof FirmwareFlashTargetState> = {
  title: "Panels/FirmwareFlashTargetState",
  component: FirmwareFlashTargetState,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    title: "Reading target identity…",
    detail: "Waiting for the selected transport to respond.",
    countdownSeconds: 11,
    busy: true,
  },
};

export default meta;

type Story = StoryObj<typeof FirmwareFlashTargetState>;

export const Probing: Story = {};

export const Reconnecting: Story = {
  args: {
    title: "Reading target identity…",
    detail: "Waiting for the selected transport to respond.",
    countdownSeconds: 14,
    busy: true,
    countdownEmphasis: "aside",
  },
};

export const WaitingForBrowserPicker: Story = {
  args: {
    title: "Waiting for browser device selection…",
    detail:
      "Choose the exact ESP32-S3 USB device in the browser dialog to start probing.",
    countdownSeconds: null,
  },
};

export const SlowProbe: Story = {
  args: {
    title: "Probe timed out.",
    detail:
      "The selected Web USB device did not respond within 5 seconds. Reconnect and try again.",
    countdownSeconds: null,
    busy: false,
  },
};

export const ReadyForReconnect: Story = {
  args: {
    title: "Authorized Web USB device is ready.",
    detail: "Reconnect to read board identity, or choose another device above.",
    countdownSeconds: null,
    busy: false,
    countdownEmphasis: "inline",
    action: (
      <button
        className="flex min-h-11 w-full items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-4 text-[12px] font-bold text-[var(--text)]"
        type="button"
      >
        Reconnect
      </button>
    ),
  },
};
