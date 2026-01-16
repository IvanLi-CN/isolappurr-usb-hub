import type { Meta, StoryObj } from "@storybook/react";

import type { StoredDevice } from "../../domain/devices";
import {
  jsonResponse,
  mockFetchDecorator,
} from "../../stories/storybook/mockFetch";
import { DeviceInfoPanel } from "./DeviceInfoPanel";

const demoDevice: StoredDevice = {
  id: "hub-a",
  name: "Desk Hub A",
  baseUrl: "http://hub-a.local",
};

const mockDeviceInfo = async (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  original: typeof fetch,
) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString(),
  );

  if (url.hostname !== "hub-a.local") {
    return original(input, init);
  }

  if (url.pathname === "/api/v1/info") {
    return jsonResponse({
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
    });
  }

  return original(input, init);
};

const meta: Meta<typeof DeviceInfoPanel> = {
  title: "Panels/DeviceInfoPanel",
  component: DeviceInfoPanel,
  parameters: {
    layout: "padded",
  },
  decorators: [mockFetchDecorator(mockDeviceInfo)],
  args: {
    device: demoDevice,
  },
};

export default meta;

type Story = StoryObj<typeof DeviceInfoPanel>;

export const Default: Story = {};
