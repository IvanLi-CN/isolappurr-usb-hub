import type { Meta, StoryObj } from "@storybook/react";

import type { StoredDevice } from "../../domain/devices";
import { DeviceCard } from "./DeviceCard";

const demoDevice: StoredDevice = {
  id: "hub-a",
  name: "Desk Hub A",
  baseUrl: "http://hub-a.local",
};

const meta: Meta<typeof DeviceCard> = {
  title: "Cards/DeviceCard",
  component: DeviceCard,
  args: {
    device: demoDevice,
    status: "online",
    unselectedFill: "panel",
    onSelect: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof DeviceCard>;

export const Default: Story = {};

export const LongBaseUrl: Story = {
  args: {
    device: {
      ...demoDevice,
      baseUrl:
        "http://hub-a.local/this/is/a/very/long/path/to/ensure/baseUrl/truncates/in/narrow/sidebars",
    },
  },
};
