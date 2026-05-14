import type { Meta, StoryObj } from "@storybook/react";

import type { StoredDevice } from "../../domain/devices";
import { DeviceInfoPanel } from "./DeviceInfoPanel";

const demoDevice: StoredDevice = {
  id: "hub-a",
  name: "Desk Hub A",
  baseUrl: "http://hub-a.local",
};

const mockInfo = {
  device: {
    device_id: "isolapurr-hub-a",
    hostname: "hub-a",
    fqdn: "hub-a.local/this/is/a/very/long/fqdn/to/ensure/truncate/works/in/narrow/layouts",
    mac: "AA:BB:CC:DD:EE:FF",
    variant: "tps-sw",
    firmware: { name: "isolapurr", version: "0.1.0" },
    uptime_ms: 123_456,
    wifi: { state: "connected", ipv4: "192.168.1.42", is_static: false },
  },
};

const meta: Meta<typeof DeviceInfoPanel> = {
  title: "Panels/DeviceInfoPanel",
  component: DeviceInfoPanel,
  parameters: {
    layout: "padded",
  },
  args: {
    device: demoDevice,
    transport: "http",
    loadInfo: async () => ({ ok: true, value: mockInfo }),
  },
};

export default meta;

type Story = StoryObj<typeof DeviceInfoPanel>;

export const Default: Story = {};

export const LocalUsbFlashing: Story = {
  args: {
    transport: "local_usb",
  },
};

export const WebSerialFlashing: Story = {
  args: {
    transport: "web_serial",
  },
};
