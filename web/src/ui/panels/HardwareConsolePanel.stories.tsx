import type { Meta, StoryObj } from "@storybook/react";

import { HardwareConsolePanel } from "./HardwareConsolePanel";

const meta: Meta<typeof HardwareConsolePanel> = {
  title: "Panels/HardwareConsolePanel",
  component: HardwareConsolePanel,
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof HardwareConsolePanel>;

export const Disconnected: Story = {
  args: {
    initialStatus: "disconnected",
    initialMode: "web_serial",
  },
};

export const ConnectedNativeProxy: Story = {
  args: {
    initialStatus: "connected",
    initialMode: "native_proxy",
    initialPorts: [
      {
        path: "/dev/cu.usbmodem1101",
        label: "ESP32-S3 USB Serial/JTAG",
        vendorId: 0x303a,
        productId: 0x1001,
        serialNumber: "ISOLAPURR-01",
      },
    ],
    initialLog: [
      'ports.get: {"ok":true,"result":{"ports":[{"portId":"port_a"}]}}',
      "Native proxy ready: 1 serial port(s)",
    ],
  },
};

export const Flashing: Story = {
  args: {
    initialStatus: "busy",
    initialMode: "web_serial",
    initialLog: ["Writing firmware 42%"],
  },
};

export const WifiConfigured: Story = {
  args: {
    initialStatus: "connected",
    initialMode: "wifi_http",
    initialLog: ['wifi.get: {"configured":true,"ssid":"Lab-5G"}'],
  },
};

export const WifiError: Story = {
  args: {
    initialStatus: "error",
    initialMode: "native_proxy",
    initialPorts: [
      {
        path: "/dev/cu.usbmodem1101",
        label: "ESP32-S3 USB Serial/JTAG",
      },
    ],
    initialLog: ["wifi.set: checksum rejected by EEPROM record validator"],
  },
};

export const OfflineFallback: Story = {
  args: {
    initialStatus: "disconnected",
    initialMode: "wifi_http",
    initialLog: ["Desktop native proxy is not running"],
  },
};
