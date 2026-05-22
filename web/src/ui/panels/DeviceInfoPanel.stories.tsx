import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

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

const mockWifiConfigured = {
  configured: true,
  storage: "eeprom",
  address: "0x50",
  ssid: "Bench WiFi",
  psk_configured: true,
};

const mockWifiEmpty = {
  configured: false,
  storage: "eeprom",
  address: "0x50",
  psk_configured: false,
};

const meta: Meta<typeof DeviceInfoPanel> = {
  title: "Panels/DeviceInfoPanel",
  component: DeviceInfoPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    device: demoDevice,
    transport: "http",
    wifiManagementTransport: null,
    loadInfo: async () => ({ ok: true, value: mockInfo }),
    loadWifiConfig: async () => ({ ok: true, value: mockWifiConfigured }),
    saveWifiConfig: async () => ({
      ok: true,
      value: { accepted: true, reboot_required: false },
    }),
    clearWifiConfig: async () => ({
      ok: true,
      value: { accepted: true, reboot_required: false },
    }),
    rebootDevice: async () => ({ ok: true, value: { accepted: true } }),
    usbCDownstreamRoute: "usb_c",
    usbCDownstreamPersisted: true,
    routeBusy: false,
    setUsbCDownstreamRoute: async () => {},
    deleteDevice: async () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof DeviceInfoPanel>;

export const Default: Story = {};

export const EmptyWifiConfig: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
    loadWifiConfig: async () => ({ ok: true, value: mockWifiEmpty }),
  },
};

export const UsbCUpgradeMode: Story = {
  args: {
    usbCDownstreamRoute: "mcu",
    usbCDownstreamPersisted: true,
  },
};

export const UsbCModeSwitchFlow: Story = {
  render: (args) => {
    const [route, setRoute] = useState(args.usbCDownstreamRoute ?? "usb_c");
    return (
      <DeviceInfoPanel
        {...args}
        usbCDownstreamRoute={route}
        setUsbCDownstreamRoute={async (nextRoute) => setRoute(nextRoute)}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Upgrade" }));
    await expect(
      canvas.getByRole("button", { name: "Upgrade" }),
    ).toBeDisabled();
  },
};

export const WifiConfigError: Story = {
  args: {
    transport: "local_usb",
    wifiManagementTransport: "local_usb",
    loadWifiConfig: async () => ({
      ok: false,
      error: { kind: "offline", message: "Local USB device not found" },
    }),
  },
};

export const HttpWithUsbManagement: Story = {
  args: {
    transport: "http",
    wifiManagementTransport: "web_serial",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Current: Wi-Fi / LAN")[0]).toBeVisible();
    await expect(canvas.getByText("Manage: Web Serial")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save Wi-Fi" }),
    ).toBeEnabled();
  },
};

export const ImmediateApplyFlow: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pskInput = await canvas.findByLabelText("PSK");
    await userEvent.clear(pskInput);
    await userEvent.type(pskInput, "newpassword");
    await userEvent.click(canvas.getByRole("button", { name: "Save Wi-Fi" }));
    await expect(
      await canvas.findByText(/saved and applying now/),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Reboot" }),
    ).not.toBeInTheDocument();
  },
};

export const InvalidShortPsk: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pskInput = await canvas.findByLabelText("PSK");
    await userEvent.clear(pskInput);
    await userEvent.type(pskInput, "short");
    await userEvent.click(canvas.getByRole("button", { name: "Save Wi-Fi" }));
    await expect(
      await canvas.findByText(/PSK must be blank or at least 8 bytes/),
    ).toBeVisible();
  },
};

export const ExistingPskRequiresReentry: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByDisplayValue("Bench WiFi");
    await userEvent.click(canvas.getByRole("button", { name: "Save Wi-Fi" }));
    await expect(
      await canvas.findByText(/choose Open network to replace the stored PSK/),
    ).toBeVisible();
  },
};

export const OpenNetworkReplacement: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByDisplayValue("Bench WiFi");
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Open network (no PSK)" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Save Wi-Fi" }));
    await expect(
      await canvas.findByText(/saved and applying now/),
    ).toBeVisible();
  },
};

export const NarrowWifiConfig: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrNarrow" },
  },
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
    loadWifiConfig: async () => ({ ok: true, value: mockWifiConfigured }),
  },
};

export const LocalUsbFlashing: Story = {
  args: {
    transport: "local_usb",
    wifiManagementTransport: "local_usb",
  },
};

export const WebSerialFlashing: Story = {
  args: {
    transport: "web_serial",
    wifiManagementTransport: "web_serial",
  },
};

export const DeleteDeviceConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete device" }),
    );
    await expect(
      await canvas.findByRole("alertdialog", {
        name: "Delete this saved device?",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByText(/does not change hardware settings/),
    ).toBeVisible();
  },
};
