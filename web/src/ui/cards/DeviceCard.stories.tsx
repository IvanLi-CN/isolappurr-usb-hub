import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";

import type { StoredDevice } from "../../domain/devices";
import { DeviceCard } from "./DeviceCard";

const demoDevice: StoredDevice = {
  id: "aabbcc001122",
  name: "Desk Hub A",
  baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
};

const meta: Meta<typeof DeviceCard> = {
  title: "Cards/DeviceCard",
  component: DeviceCard,
  tags: ["autodocs"],
  args: {
    device: demoDevice,
    status: "online",
    transportBadges: [{ transport: "http", state: "primary" }],
    unselectedFill: "panel",
    onSelect: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof DeviceCard>;

export const Default: Story = {};

export const Selected: Story = {
  args: {
    selected: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByRole("button", { current: "page" });
    await expect(card).toHaveAttribute("aria-current", "page");
    await expect(
      canvas.getByTestId(`device-selected-marker-${demoDevice.id}`),
    ).toBeVisible();
    await userEvent.click(card);
    await expect(args.onSelect).toHaveBeenCalledWith(demoDevice.id);
  },
};

export const SelectedDark: Story = {
  ...Selected,
  decorators: [
    (Story) => (
      <div
        className="min-h-[180px] bg-[var(--bg)] p-6"
        data-theme="isolapurr-dark"
      >
        <Story />
      </div>
    ),
  ],
};

export const ConnectedAndHistory: Story = {
  args: {
    transportBadges: [
      { transport: "web_serial", state: "primary" },
      { transport: "http", state: "connected" },
      { transport: "local_usb", state: "history" },
    ],
  },
};

export const SerialHistoryOnly: Story = {
  args: {
    status: "offline",
    transportBadges: [
      { transport: "http", state: "connected" },
      { transport: "web_serial", state: "history" },
    ],
  },
};
