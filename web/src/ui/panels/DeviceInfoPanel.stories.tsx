import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import type { StoredDevice } from "../../domain/devices";
import { DeviceInfoPanel } from "./DeviceInfoPanel";

const demoDevice: StoredDevice = {
  id: "aabbcc001122",
  name: "Desk Hub A",
  baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
};

const mockInfo = {
  device: {
    device_id: "aabbcc001122",
    hostname: "isolapurr-usb-hub-aabbcc001122",
    fqdn: "isolapurr-usb-hub-aabbcc001122.local/this/is/a/very/long/fqdn/to/ensure/truncate/works/in/narrow/layouts",
    mac: "AA:BB:CC:DD:EE:FF",
    variant: "tps-sw",
    firmware: { name: "isolapurr-usb-hub", version: "0.1.0" },
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
    canControlHardware: true,
    requestControlTakeover: () => undefined,
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
    resetSettings: async (scope) => ({
      ok: true,
      value:
        scope === "wifi"
          ? { accepted: true, scope, reboot_required: false }
          : { accepted: true, scope, wifi_preserved: true },
    }),
    rebootDevice: async () => ({ ok: true, value: { accepted: true } }),
    usbCDownstreamRoute: "usb_c",
    usbCDownstreamPersisted: true,
    routeBusy: false,
    setUsbCDownstreamRoute: async () => {},
    openFirmwareFlashPage: () => {},
    deleteDevice: async () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof DeviceInfoPanel>;

export const Default: Story = {};

export const LongIdentityValues: Story = {
  args: {
    loadInfo: async () => ({
      ok: true,
      value: {
        device: {
          ...mockInfo.device,
          device_id: "isolapurr-hub-aabbccddeeff00112233445566778899",
          hostname: "isolapurr-usb-hub-aabbcc001122-bench-south-east",
          fqdn: "hub-a.local/this/is/a/very/long/fqdn/to/ensure/truncate/works/in/narrow/layouts/without/pushing/other/fields/off-grid",
          variant: "tps-sw-rev-b-lab-build",
        },
      },
    }),
  },
};

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

export const NarrowLongIdentityValues: Story = {
  parameters: {
    viewport: { defaultViewport: "isolapurrNarrow" },
  },
  args: LongIdentityValues.args,
};

export const ResetSettingsHttpOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const resetButtons = await canvas.findAllByRole("button", {
      name: "Reset",
    });
    await expect(resetButtons[0]).toBeDisabled();
    await expect(resetButtons[1]).toBeEnabled();
    await expect(
      canvas.getByText(/Wi-Fi reset is disabled on Wi-Fi\/LAN/),
    ).toBeVisible();
  },
};

export const ResetSettingsUsbFlow: Story = {
  args: {
    transport: "local_usb",
    wifiManagementTransport: "local_usb",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const resetButtons = await canvas.findAllByRole("button", {
      name: "Reset",
    });
    await userEvent.click(resetButtons[1]);
    await expect(
      await page.findByText(/Confirm this reset for other/),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Confirm" }));
    await expect(await canvas.findByText(/Other settings reset/)).toBeVisible();
  },
};

export const ControlledInAnotherTab: Story = {
  args: {
    transport: "local_usb",
    wifiManagementTransport: "local_usb",
    canControlHardware: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(
        /another browser tab currently owns live hardware control/i,
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Take over control" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save Wi-Fi" }),
    ).toBeDisabled();
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
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete device" }),
    );
    await expect(
      await page.findByRole("alertdialog", {
        name: "Delete this saved device?",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/does not change hardware settings/),
    ).toBeVisible();
  },
};
