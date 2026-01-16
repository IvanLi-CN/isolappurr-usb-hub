import type { Meta, StoryObj } from "@storybook/react";

import { DeviceRuntimeProvider } from "../../app/device-runtime";
import { DevicesProvider } from "../../app/devices-store";
import type { StoredDevice } from "../../domain/devices";
import {
  jsonResponse,
  mockFetchDecorator,
} from "../../stories/storybook/mockFetch";
import { ToastProvider } from "../toast/ToastProvider";
import { DeviceDashboardPanel } from "./DeviceDashboardPanel";

const demoDevice: StoredDevice = {
  id: "hub-a",
  name: "Desk Hub A",
  baseUrl: "http://hub-a.local",
};

const mockDeviceApi = async (
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

  if (url.pathname === "/api/v1/ports") {
    return jsonResponse({
      ports: [
        {
          portId: "port_a",
          label: "USB-A",
          telemetry: {
            status: "ok",
            voltage_mv: 5000,
            current_ma: 420,
            power_mw: 2100,
            sample_uptime_ms: 123_456,
          },
          state: {
            power_enabled: true,
            data_connected: true,
            replugging: false,
            busy: false,
          },
          capabilities: { data_replug: true, power_set: true },
        },
        {
          portId: "port_c",
          label: "USB-C",
          telemetry: {
            status: "ok",
            voltage_mv: 9000,
            current_ma: 310,
            power_mw: 2790,
            sample_uptime_ms: 123_456,
          },
          state: {
            power_enabled: false,
            data_connected: false,
            replugging: false,
            busy: false,
          },
          capabilities: { data_replug: true, power_set: true },
        },
      ],
    });
  }

  if (url.pathname.endsWith("/actions/replug")) {
    return jsonResponse({ accepted: true });
  }

  if (url.pathname.includes("/power")) {
    const enabled = url.searchParams.get("enabled") === "1";
    return jsonResponse({ accepted: true, power_enabled: enabled });
  }

  return original(input, init);
};

const meta: Meta<typeof DeviceDashboardPanel> = {
  title: "Panels/DeviceDashboardPanel",
  component: DeviceDashboardPanel,
  parameters: {
    layout: "padded",
  },
  decorators: [
    mockFetchDecorator(mockDeviceApi),
    (Story) => (
      <ToastProvider>
        <DevicesProvider initialDevices={[demoDevice]}>
          <DeviceRuntimeProvider>
            <div className="max-w-[980px]">
              <Story />
            </div>
          </DeviceRuntimeProvider>
        </DevicesProvider>
      </ToastProvider>
    ),
  ],
  args: {
    device: demoDevice,
  },
};

export default meta;

type Story = StoryObj<typeof DeviceDashboardPanel>;

export const Default: Story = {};
