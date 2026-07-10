import type { Meta, StoryObj } from "@storybook/react";

import { FirmwareFlashLogPanel } from "./FirmwareFlashLogPanel";

const entries = [
  {
    id: "1",
    timestampLabel: "00:00",
    level: "info" as const,
    message: "Prepared bundled release v0.5.1.",
  },
  {
    id: "2",
    timestampLabel: "00:02",
    level: "info" as const,
    message: "Writing firmware over Web Serial…",
  },
  {
    id: "3",
    timestampLabel: "00:07",
    level: "success" as const,
    message: "Flash completed. Re-reading target identity.",
  },
];

const meta: Meta<typeof FirmwareFlashLogPanel> = {
  title: "Panels/FirmwareFlashLogPanel",
  component: FirmwareFlashLogPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    title: "Flash progress appears here.",
    detail: "Use Local USB or Web USB to start firmware flashing.",
    status: "idle",
    progressPercent: null,
    entries: [],
    emptyText: "Detailed flash log will appear here.",
  },
};

export default meta;

type Story = StoryObj<typeof FirmwareFlashLogPanel>;

export const Idle: Story = {};

export const Running: Story = {
  args: {
    title: "Writing firmware over Web Serial…",
    detail: "App image is streaming to 0x10000.",
    status: "working",
    progressPercent: 62,
    entries,
    emptyText: "Detailed flash log will appear here.",
  },
};

export const LocalUsbBridge: Story = {
  args: {
    title: "Writing through Local USB bridge…",
    detail: "Desktop bridge is programming the selected ESP32-S3 target.",
    status: "working",
    progressPercent: 44,
    indeterminate: true,
    entries: entries.slice(0, 2),
    emptyText: "Detailed flash log will appear here.",
  },
};

export const Failed: Story = {
  args: {
    title: "Flash failed.",
    detail: "Failed to open serial port. Reconnect the target and try again.",
    status: "error",
    progressPercent: 18,
    entries: [
      {
        id: "1",
        timestampLabel: "00:00",
        level: "info",
        message: "Prepared bundled release v0.5.1.",
      },
      {
        id: "4",
        timestampLabel: "00:03",
        level: "error",
        message:
          "Failed to execute 'open' on 'SerialPort': Failed to open serial port.",
      },
    ],
    emptyText: "Detailed flash log will appear here.",
  },
};
