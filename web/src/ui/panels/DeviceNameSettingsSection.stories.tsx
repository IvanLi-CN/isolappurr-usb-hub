import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { useState } from "react";

import type {
  DeviceInfoResponse,
  DeviceNameMutationResponse,
  Result,
} from "../../domain/deviceApi";
import { DeviceNameSettingsSection } from "./DeviceNameSettingsSection";

const supportedInfo: DeviceInfoResponse = {
  device: {
    device_id: "aabbcc001122",
    hostname: "isolapurr-usb-hub-aabbcc001122",
    fqdn: "isolapurr-usb-hub-aabbcc001122.local",
    mac: "AA:BB:CC:DD:EE:FF",
    display_name: "Bench 猫",
    variant: "tps-sw",
    firmware: { name: "isolapurr-usb-hub", version: "0.1.0" },
    uptime_ms: 123_456,
    wifi: { state: "connected", ipv4: "192.168.1.42", is_static: false },
  },
  capabilities: { identify: true, device_name: true },
};

const unsupportedInfo: DeviceInfoResponse = {
  ...supportedInfo,
  device: { ...supportedInfo.device, display_name: undefined },
  capabilities: { identify: true },
};

const okResult = (
  value: DeviceNameMutationResponse,
): Result<DeviceNameMutationResponse> => ({ ok: true, value });

function EvidenceSurface({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-visual-evidence-surface
      style={{ background: "var(--bg)", minHeight: "260px", padding: "32px" }}
    >
      <div data-visual-evidence-target>{children}</div>
    </div>
  );
}

const meta: Meta<typeof DeviceNameSettingsSection> = {
  title: "Panels/DeviceNameSettingsSection",
  component: DeviceNameSettingsSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <EvidenceSurface>
        <Story />
      </EvidenceSurface>
    ),
  ],
  args: {
    deviceId: "aabbcc001122",
    info: supportedInfo,
    sharedRevision: 0,
    transport: "http",
    busy: false,
    reloadInfo: async () => ({ ok: true, value: supportedInfo }),
    setName: async (name) => okResult({ display_name: name }),
    clearName: async () => okResult({ display_name: null }),
  },
};

export default meta;

type Story = StoryObj<typeof DeviceNameSettingsSection>;

export const Resting: Story = {};

export const UnsupportedFirmware: Story = {
  args: { info: unsupportedInfo, transport: "local_usb" },
};

export const Busy: Story = {
  args: { busy: true, transport: "web_serial" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("device-name-settings")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(canvas.getByTestId("device-name-busy-status")).toBeVisible();
  },
};

export const EepromError: Story = {
  args: {
    setName: async () => ({
      ok: false,
      error: {
        kind: "api_error",
        status: 500,
        code: "eeprom_failed",
        message: "Device display name could not be saved to EEPROM U21.",
        retryable: true,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByDisplayValue("Bench 猫");
    const saveButton = canvas.getByRole("button", { name: "Save" });
    await expect(saveButton).not.toBeDisabled();
    await userEvent.click(saveButton);
    await expect((await canvas.findByRole("alert")).textContent).toContain(
      "EEPROM",
    );
  },
};

export const ConcurrentEdit: Story = {
  render: (args) => {
    const [revision, setRevision] = useState(0);
    const [info, setInfo] = useState(supportedInfo);
    return (
      <div className="flex flex-col gap-3">
        <DeviceNameSettingsSection
          {...args}
          info={info}
          sharedRevision={revision}
          reloadInfo={async () => ({ ok: true, value: info })}
        />
        <button
          className="iso-action"
          type="button"
          onClick={() => {
            setRevision((current) => current + 1);
            setInfo({
              ...supportedInfo,
              device: { ...supportedInfo.device, display_name: "Other tab" },
            });
          }}
        >
          Simulate another tab
        </button>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId("device-name-input");
    await userEvent.clear(input);
    await userEvent.type(input, "My draft");
    await userEvent.click(
      canvas.getByRole("button", { name: "Simulate another tab" }),
    );
    await expect(canvas.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect((await canvas.findByRole("alert")).textContent).toContain(
      "another tab",
    );
  },
};
