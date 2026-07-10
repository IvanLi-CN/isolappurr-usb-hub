import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { MemoryRouter } from "react-router";

import { AddDeviceUiProvider } from "../../app/add-device-ui";
import { DemoModeProvider } from "../../app/demo-mode";
import { DesktopAgentProvider } from "../../app/desktop-agent-ui";
import { DeviceRuntimeProvider } from "../../app/device-runtime";
import { DevicesProvider } from "../../app/devices-store";
import { ThemeProvider } from "../../app/theme-ui";
import type { StoredDevice } from "../../domain/devices";
import { DeviceListPanel } from "../panels/DeviceListPanel";
import { ToastProvider } from "../toast/ToastProvider";
import { AppLayout } from "./AppLayout";

const devices: StoredDevice[] = [
  { id: "demo-a", name: "Demo Hub A", baseUrl: "http://192.168.1.23" },
  { id: "demo-b", name: "Demo Hub B", baseUrl: "http://usb-hub.local" },
];

const meta: Meta<typeof AppLayout> = {
  title: "Layouts/AppLayout",
  component: AppLayout,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story, context) => (
      <MemoryRouter>
        <DemoModeProvider>
          <DesktopAgentProvider>
            <ThemeProvider>
              <ToastProvider>
                <DevicesProvider initialDevices={devices}>
                  <DeviceRuntimeProvider>
                    <AddDeviceUiProvider
                      existingDeviceIds={devices.map((d) => d.id)}
                      existingDeviceBaseUrls={devices.map((d) => d.baseUrl)}
                      onCreate={async () => ({
                        ok: true,
                        device: devices[0],
                      })}
                    >
                      <div
                        className="min-h-screen bg-[var(--bg)] text-[var(--text)]"
                        data-theme={
                          context.parameters.isolapurrTheme ?? "isolapurr"
                        }
                      >
                        <Story />
                      </div>
                    </AddDeviceUiProvider>
                  </DeviceRuntimeProvider>
                </DevicesProvider>
              </ToastProvider>
            </ThemeProvider>
          </DesktopAgentProvider>
        </DemoModeProvider>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AppLayout>;

export const Default: Story = {
  args: {
    sidebar: (
      <DeviceListPanel
        devices={devices}
        selectedDeviceId="demo-a"
        onSelect={() => {}}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        <div className="text-[24px] font-bold">AppLayout</div>
        <div className="text-[14px] font-medium text-[var(--muted)]">
          This is the top-level layout used by the dashboard pages.
        </div>
      </div>
    ),
  },
};

export const Desktop: Story = {
  ...Default,
  parameters: {
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("device-card-demo-a")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(canvas.getByTestId("device-card-demo-b")).not.toHaveAttribute(
      "aria-current",
    );
  },
};

export const Mobile: Story = {
  ...Default,
  parameters: {
    viewport: { defaultViewport: "isolapurrMobile" },
  },
};

export const DarkDesktop: Story = {
  ...Default,
  parameters: {
    isolapurrTheme: "isolapurr-dark",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};
