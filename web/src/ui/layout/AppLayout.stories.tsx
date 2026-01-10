import type { Meta, StoryObj } from "@storybook/react";

import type { StoredDevice } from "../../domain/devices";
import { DeviceListPanel } from "../panels/DeviceListPanel";
import { AppLayout } from "./AppLayout";

const meta: Meta<typeof AppLayout> = {
  title: "Layouts/AppLayout",
  component: AppLayout,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-screen" data-theme="light">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AppLayout>;

const devices: StoredDevice[] = [
  { id: "demo-a", name: "Demo Hub A", baseUrl: "http://192.168.1.23" },
  { id: "demo-b", name: "Demo Hub B", baseUrl: "http://usb-hub.local" },
];

export const Default: Story = {
  args: {
    sidebar: (
      <DeviceListPanel
        devices={devices}
        selectedDeviceId="demo-a"
        onSelect={() => {}}
        onRemove={() => {}}
        onAdd={() => {}}
      />
    ),
    children: (
      <div className="prose max-w-none">
        <h1>AppLayout</h1>
        <p>This is the top-level layout used by the dashboard pages.</p>
      </div>
    ),
  },
};

export const Desktop: Story = {
  ...Default,
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};

export const Mobile: Story = {
  ...Default,
  parameters: {
    viewport: { defaultViewport: "isolapurrMobile" },
  },
};
