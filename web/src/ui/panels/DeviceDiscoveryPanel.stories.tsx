import type { Meta, StoryObj } from "@storybook/react";

import type { DiscoverySnapshot } from "../../domain/discovery";
import { DeviceDiscoveryPanel } from "./DeviceDiscoveryPanel";

const baseSnapshot: DiscoverySnapshot = {
  mode: "service",
  status: "unavailable",
  devices: [],
  ipScan: { expanded: false, autoExpandAfterMs: 30_000 },
};

const meta: Meta<typeof DeviceDiscoveryPanel> = {
  title: "Panels/DeviceDiscoveryPanel",
  component: DeviceDiscoveryPanel,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-[var(--bg)] p-8" data-theme="isolapurr">
        <div className="h-[680px] w-[480px]">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    snapshot: baseSnapshot,
    existingDeviceIds: ["f293cc9c139e"],
    existingDeviceBaseUrls: ["http://192.168.31.224"],
    onRefresh: () => {},
    onToggleIpScan: () => {},
    onStartScan: () => {},
    onCancelScan: () => {},
    onSelect: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof DeviceDiscoveryPanel>;

export const WebUnavailable: Story = {
  args: {
    snapshot: baseSnapshot,
  },
};

export const WithResults: Story = {
  args: {
    snapshot: {
      mode: "scan",
      status: "ready",
      devices: [
        {
          baseUrl: "http://192.168.31.224",
          device_id: "f293cc9c139e",
          hostname: "isolapurr-usb-hub-f293cc9c139e",
          fqdn: "isolapurr-usb-hub-f293cc9c139e.local",
          ipv4: "192.168.31.224",
          firmware: { name: "isolapurr-usb-hub", version: "0.1.0" },
          last_seen_at: "2026-01-14T00:00:00.000Z",
        },
        {
          baseUrl: "http://192.168.31.233",
          device_id: "a1b2c3d4e5f6",
          hostname: "isolapurr-usb-hub-a1b2c3d4e5f6",
          fqdn: "isolapurr-usb-hub-a1b2c3d4e5f6.local",
          ipv4: "192.168.31.233",
          firmware: { name: "isolapurr-usb-hub", version: "0.1.0" },
          last_seen_at: "2026-01-14T00:00:00.000Z",
        },
      ],
      ipScan: { expanded: true, expandedBy: "user" },
      scan: { cidr: "192.168.31.0/24", done: 254, total: 254 },
    },
  },
};

export const WithAddedBadge: Story = {
  args: WithResults.args,
};

export const ScanningIpScan: Story = {
  args: {
    snapshot: {
      mode: "scan",
      status: "scanning",
      devices: [],
      ipScan: { expanded: true, expandedBy: "auto" },
      scan: { cidr: "192.168.31.0/24", done: 42, total: 254 },
    },
  },
};

export const BrowserBlockedHint: Story = {
  args: {
    snapshot: {
      ...baseSnapshot,
      status: "ready",
      error:
        "Browser blocked private-network access. Allow LAN access in the browser, or connect by USB first to verify and save the IPv4 path.",
      ipScan: { expanded: true, expandedBy: "auto" },
    },
  },
};
