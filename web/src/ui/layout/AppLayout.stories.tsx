import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { MemoryRouter } from "react-router";

import { AddDeviceUiProvider } from "../../app/add-device-ui";
import { DemoModeProvider } from "../../app/demo-mode";
import { DemoLink } from "../../app/demo-navigation";
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
      <MemoryRouter initialEntries={[context.parameters.route ?? "/"]}>
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

const renderSidebar = ({
  closeMobileSidebar,
  forMobileDrawer,
}: {
  closeMobileSidebar: () => void;
  forMobileDrawer: boolean;
}) => (
  <DeviceListPanel
    devices={devices}
    footer={
      forMobileDrawer ? (
        <DemoLink
          className="flex h-10 items-center justify-center rounded-[12px] border border-[var(--border)] bg-transparent px-4 text-[13px] font-bold text-[var(--text)]"
          to="/about"
          onClick={closeMobileSidebar}
          data-testid="mobile-device-drawer-about"
        >
          About
        </DemoLink>
      ) : undefined
    }
    headerAccessory={
      forMobileDrawer ? (
        <button
          aria-label="Close devices"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[18px] font-semibold text-[var(--muted)]"
          type="button"
          onClick={closeMobileSidebar}
        >
          ×
        </button>
      ) : undefined
    }
    onBeforeAddDevice={forMobileDrawer ? closeMobileSidebar : undefined}
    onSelect={() => closeMobileSidebar()}
    selectedDeviceId="demo-a"
  />
);

export const Default: Story = {
  args: {
    sidebar: renderSidebar,
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

export const DeviceHeaderDesktop: Story = {
  ...Default,
  args: {
    ...Default.args,
    headerInfo: {
      title: "isolapurr-usb-hub-856a141cdbd4",
      subtitle: "id: 856a14 • http://192.168.31.122",
      mobileTitle: "isolapurr-usb-hub-856a141cdbd4",
    },
  },
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-device-title"),
    ).toHaveTextContent("isolapurr-usb-hub-856a141cdbd4");
    await expect(
      canvas.getByTestId("app-header-device-subtitle"),
    ).toHaveTextContent("id: 856a14 • http://192.168.31.122");
  },
};

export const DashboardMobileDrawer: Story = {
  ...Default,
  args: {
    ...Default.args,
    showMobileSidebarDrawer: true,
  },
  parameters: {
    route: "/",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("mobile-device-drawer-trigger"));
    await expect(canvas.getByTestId("mobile-device-drawer")).toBeVisible();
    await expect(
      canvas.getByTestId("mobile-device-drawer-about"),
    ).toBeInTheDocument();
  },
};

export const DeviceHeaderMobileDrawer: Story = {
  ...Default,
  args: {
    ...Default.args,
    headerInfo: {
      title: "isolapurr-usb-hub-856a141cdbd4",
      subtitle: "id: 856a14 • http://192.168.31.122",
      mobileTitle: "isolapurr-usb-hub-856a141cdbd4",
    },
    showMobileSidebarDrawer: true,
  },
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-mobile-title"),
    ).toHaveTextContent("isolapurr-usb-hub-856a141cdbd4");
    await userEvent.click(canvas.getByTestId("mobile-device-drawer-trigger"));
    await expect(canvas.getByTestId("mobile-device-drawer")).toBeVisible();
  },
};

export const DarkDesktop: Story = {
  ...Default,
  parameters: {
    isolapurrTheme: "isolapurr-dark",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};
