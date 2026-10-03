import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { AddDeviceUiProvider } from "../../app/add-device-ui";
import { DemoModeProvider, useDemoMode } from "../../app/demo-mode";
import { createCanonicalDemoWorld } from "../../app/demo-mode-world";
import { DemoLink } from "../../app/demo-navigation";
import { DesktopAgentProvider } from "../../app/desktop-agent-ui";
import {
  DeviceRuntimeProvider,
  useDeviceRuntime,
} from "../../app/device-runtime";
import { DevicesProvider } from "../../app/devices-store";
import { ThemeProvider } from "../../app/theme-ui";
import type { StoredDevice } from "../../domain/devices";
import type { JsonlRequest } from "../../domain/hardwareConsole";
import {
  WebSerialJsonlTransport,
  type WebSerialOperationOptions,
} from "../../domain/webSerialFirmware";
import {
  disconnectWebSerialDeviceTransport,
  getWebSerialDeviceTransport,
  setWebSerialDeviceTransport,
} from "../../domain/webSerialLinks";
import type { PwaInstallContextValue } from "../../pwa/install";
import { PwaInstallProvider } from "../../pwa/install";
import { DeviceListPanel } from "../panels/DeviceListPanel";
import { ToastProvider } from "../toast/ToastProvider";
import { AppLayout } from "./AppLayout";
import { formatDeviceClipboardContent } from "./deviceClipboard";

const runtimeScopeDevice = createCanonicalDemoWorld().devices[0];
const runtimeScopeDeviceId = runtimeScopeDevice.stored.id;
let runtimeScopeSerialTransport: RuntimeScopeSerialTransport | null = null;

class RuntimeScopeSerialTransport extends WebSerialJsonlTransport {
  disconnectCalls = 0;

  override getActivePortUsbInfo() {
    return { usbVendorId: 0x303a, usbProductId: 0x1001 };
  }

  override async request(
    request: JsonlRequest,
    options?: WebSerialOperationOptions,
  ): Promise<unknown> {
    if (options?.beforeDispatch && !options.beforeDispatch()) {
      throw new Error("Mock Web Serial request rejected before dispatch");
    }
    const result =
      request.method === "ports.get"
        ? runtimeScopeDevice.ports
        : request.method === "info"
          ? runtimeScopeDevice.info
          : request.method === "power.config_get"
            ? runtimeScopeDevice.power
            : { accepted: true };
    return { ok: true, result };
  }

  override async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    await super.disconnect();
  }
}

function RuntimeScopeResetProbe() {
  const { enabled, bootstrap } = useDemoMode();
  const runtime = useDeviceRuntime();
  const [, setLinkRevision] = useState(0);
  const presentation = runtime.connectionPresentation(runtimeScopeDeviceId);
  const activeEndpoint =
    runtime.runtimeById[runtimeScopeDeviceId]?.activeEndpoint?.kind ??
    "Unavailable";

  const attachSerialTransport = () => {
    const transport = new RuntimeScopeSerialTransport();
    runtimeScopeSerialTransport = transport;
    setWebSerialDeviceTransport(runtimeScopeDeviceId, transport);
    setLinkRevision((revision) => revision + 1);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div data-testid="runtime-scope-state">
        {enabled ? "Demo" : "Live"}: {presentation.connectionLabel}:{" "}
        {presentation.endpointLabel}
      </div>
      <div data-testid="runtime-scope-active-endpoint">{activeEndpoint}</div>
      <div data-testid="runtime-scope-serial-link">
        {getWebSerialDeviceTransport(runtimeScopeDeviceId)
          ? "Web Serial link active"
          : "Web Serial link unavailable"}
      </div>
      <div data-testid="runtime-scope-disconnect-count">
        {runtimeScopeSerialTransport?.disconnectCalls ?? 0}
      </div>
      <button type="button" onClick={attachSerialTransport}>
        Attach mock Web Serial
      </button>
      <button type="button" onClick={() => bootstrap("/", "?demo=false")}>
        Set live scope
      </button>
      <button
        type="button"
        onClick={() => bootstrap("/", enabled ? "?demo=false" : "?demo=true")}
      >
        Switch runtime scope
      </button>
    </div>
  );
}

function deviceHeaderInfo(connection: string, endpoint: string) {
  const title = "isolapurr-usb-hub-856a141cdbd4";
  return {
    title,
    subtitle: `id: 856a14 • ${endpoint}`,
    mobileTitle: title,
    clipboardContent: formatDeviceClipboardContent({
      deviceName: title,
      deviceId: "856a141cdbd4",
      connection,
      endpoint,
    }),
  };
}

const devices: StoredDevice[] = [
  { id: "demo-a", name: "Demo Hub A", baseUrl: "http://192.168.1.23" },
  { id: "demo-b", name: "Demo Hub B", baseUrl: "http://usb-hub.local" },
];

const meta: Meta<typeof AppLayout> = {
  title: "Layouts/AppLayout",
  component: AppLayout,
  tags: ["autodocs"],
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
                <PwaInstallProvider
                  mockValue={
                    context.parameters.pwaInstall as
                      | Partial<PwaInstallContextValue>
                      | undefined
                  }
                >
                  <DevicesProvider
                    initialDevices={
                      (context.parameters.runtimeDevices as
                        | StoredDevice[]
                        | undefined) ?? devices
                    }
                  >
                    <DeviceRuntimeProvider>
                      <AddDeviceUiProvider
                        existingDeviceIds={(
                          (context.parameters.runtimeDevices as
                            | StoredDevice[]
                            | undefined) ?? devices
                        ).map((d) => d.id)}
                        existingDeviceBaseUrls={(
                          (context.parameters.runtimeDevices as
                            | StoredDevice[]
                            | undefined) ?? devices
                        ).map((d) => d.baseUrl)}
                        onCreate={async () => ({
                          ok: true,
                          device: devices[0],
                        })}
                      >
                        <div
                          className="min-h-screen bg-[var(--bg)] text-[var(--text)]"
                          data-visual-evidence-surface
                          data-theme={
                            context.parameters.isolapurrTheme ?? "isolapurr"
                          }
                        >
                          <div data-visual-evidence-target>
                            <Story />
                          </div>
                        </div>
                      </AddDeviceUiProvider>
                    </DeviceRuntimeProvider>
                  </DevicesProvider>
                </PwaInstallProvider>
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

export const RuntimeScopeSwitchClearsState: Story = {
  ...Default,
  tags: ["runtime-scope-switch"],
  parameters: {
    ...Default.parameters,
    runtimeDevices: [
      {
        ...runtimeScopeDevice.stored,
        baseUrl: "http://scope-switch.invalid",
        transports: { httpBaseUrl: "http://scope-switch.invalid" },
      },
    ],
  },
  args: {
    ...Default.args,
    sidebar: () => null,
    children: <RuntimeScopeResetProbe />,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const expectActiveSerialRuntime = async () => {
      await userEvent.click(
        canvas.getByRole("button", { name: "Attach mock Web Serial" }),
      );
      await waitFor(() => {
        expect(
          canvas.getByTestId("runtime-scope-active-endpoint"),
        ).toHaveTextContent("web_serial");
        expect(canvas.getByTestId("runtime-scope-state")).toHaveTextContent(
          "Browser-authorized serial port (VID 0x303A, PID 0x1001)",
        );
        expect(
          canvas.getByTestId("runtime-scope-serial-link"),
        ).toHaveTextContent("Web Serial link active");
      });
    };
    const expectClearedScope = async (
      scope: "Live",
      disconnectCount: string,
    ) => {
      await waitFor(() => {
        expect(canvas.getByTestId("runtime-scope-state")).toHaveTextContent(
          `${scope}: Not connected: Unavailable`,
        );
        expect(
          canvas.getByTestId("runtime-scope-active-endpoint"),
        ).toHaveTextContent("Unavailable");
        expect(
          canvas.getByTestId("runtime-scope-serial-link"),
        ).toHaveTextContent("Web Serial link unavailable");
        expect(
          canvas.getByTestId("runtime-scope-disconnect-count"),
        ).toHaveTextContent(disconnectCount);
      });
    };
    const expectScopeWithoutPreviousSerial = async (
      scope: "Demo",
      disconnectCount: string,
    ) => {
      await waitFor(() => {
        expect(canvas.getByTestId("runtime-scope-state")).toHaveTextContent(
          `${scope}:`,
        );
        expect(
          canvas.getByTestId("runtime-scope-active-endpoint"),
        ).not.toHaveTextContent("web_serial");
        expect(
          canvas.getByTestId("runtime-scope-serial-link"),
        ).toHaveTextContent("Web Serial link unavailable");
        expect(
          canvas.getByTestId("runtime-scope-disconnect-count"),
        ).toHaveTextContent(disconnectCount);
      });
    };

    try {
      await userEvent.click(
        canvas.getByRole("button", { name: "Set live scope" }),
      );
      await expectClearedScope("Live", "0");
      await expectActiveSerialRuntime();
      await userEvent.click(
        canvas.getByRole("button", { name: "Switch runtime scope" }),
      );
      await expectScopeWithoutPreviousSerial("Demo", "1");
      await userEvent.click(
        canvas.getByRole("button", { name: "Switch runtime scope" }),
      );
      await expectClearedScope("Live", "1");
    } finally {
      await userEvent.click(
        canvas.getByRole("button", { name: "Set live scope" }),
      );
      if (getWebSerialDeviceTransport(runtimeScopeDeviceId)) {
        await disconnectWebSerialDeviceTransport(runtimeScopeDeviceId);
      }
      runtimeScopeSerialTransport = null;
    }
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
    headerInfo: deviceHeaderInfo("Wi-Fi / LAN", "http://192.168.31.122"),
  },
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-device-title"),
    ).toHaveTextContent(args.headerInfo?.title ?? "");
    await expect(
      canvas.getByTestId("app-header-device-subtitle"),
    ).toHaveTextContent(args.headerInfo?.subtitle ?? "");
  },
};

export const DeviceHeaderLocalUsb: Story = {
  ...DeviceHeaderDesktop,
  args: {
    ...DeviceHeaderDesktop.args,
    headerInfo: deviceHeaderInfo("Local USB", "/dev/cu.usbmodem21231401"),
  },
};

export const DeviceHeaderWebSerial: Story = {
  ...DeviceHeaderDesktop,
  args: {
    ...DeviceHeaderDesktop.args,
    headerInfo: deviceHeaderInfo(
      "Web Serial",
      "Browser-authorized serial port (VID 0x303A, PID 0x1001)",
    ),
  },
};

export const DeviceHeaderWebSerialDetailsUnavailable: Story = {
  ...DeviceHeaderDesktop,
  args: {
    ...DeviceHeaderDesktop.args,
    headerInfo: deviceHeaderInfo(
      "Web Serial",
      "Browser-authorized serial port (details unavailable)",
    ),
  },
};

export const DeviceHeaderDisconnected: Story = {
  ...DeviceHeaderDesktop,
  args: {
    ...DeviceHeaderDesktop.args,
    headerInfo: deviceHeaderInfo("Not connected", "Unavailable"),
  },
};

export const DeviceHeaderLongEndpoint: Story = {
  ...DeviceHeaderDesktop,
  args: {
    ...DeviceHeaderDesktop.args,
    headerInfo: deviceHeaderInfo(
      "Local USB",
      "/dev/serial/by-id/usb-IsolaPurr_USB_Hub_0123456789abcdef-if00",
    ),
  },
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-mobile-subtitle"),
    ).toHaveTextContent(args.headerInfo?.subtitle ?? "");
  },
};

export const DashboardMobileDrawer: Story = {
  ...Default,
  args: {
    ...Default.args,
    showMobileSidebarDrawer: true,
  },
  tags: ["skip-test"],
  parameters: {
    route: "/",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("mobile-device-drawer-trigger"),
    ).toBeVisible();
    await expect(canvas.queryByTestId("device-list")).not.toBeInTheDocument();
  },
};

export const DeviceHeaderMobileDrawer: Story = {
  ...Default,
  args: {
    ...Default.args,
    headerInfo: deviceHeaderInfo(
      "Web Serial",
      "Browser-authorized serial port (VID 0x303A, PID 0x1001)",
    ),
    showMobileSidebarDrawer: true,
  },
  tags: ["skip-test"],
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-mobile-title"),
    ).toHaveTextContent("isolapurr-usb-hub-856a141cdbd4");
    await expect(
      canvas.getByTestId("app-header-mobile-subtitle"),
    ).toHaveTextContent(
      "id: 856a14 • Browser-authorized serial port (VID 0x303A, PID 0x1001)",
    );
    await expect(
      canvas.getByTestId("mobile-device-drawer-trigger"),
    ).toBeVisible();
  },
};

export const DeviceHeaderMobileEndpoint: Story = {
  ...Default,
  args: {
    ...Default.args,
    headerInfo: deviceHeaderInfo(
      "Web Serial",
      "Browser-authorized serial port (VID 0x303A, PID 0x1001)",
    ),
  },
  parameters: {
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrMobile" },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-mobile-subtitle"),
    ).toHaveTextContent(args.headerInfo?.subtitle ?? "");
  },
};

export const DeviceHeaderMobileHttp: Story = {
  ...DeviceHeaderMobileEndpoint,
  args: {
    ...DeviceHeaderMobileEndpoint.args,
    headerInfo: deviceHeaderInfo("Wi-Fi / LAN", "http://192.168.31.122"),
  },
};

export const DeviceHeaderMobileDisconnected: Story = {
  ...DeviceHeaderMobileEndpoint,
  args: {
    ...DeviceHeaderMobileEndpoint.args,
    headerInfo: deviceHeaderInfo("Not connected", "Unavailable"),
  },
};

export const DarkDesktop: Story = {
  ...Default,
  parameters: {
    isolapurrTheme: "isolapurr-dark",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
};

export const PromptableDesktop: Story = {
  ...Default,
  parameters: {
    pwaInstall: {
      canPromptInstall: true,
      displayMode: "browser",
      installStatus: "promptable",
      isInstalled: false,
      isWindowControlsOverlayVisible: false,
      promptInstall: async () => "accepted",
    } satisfies Partial<PwaInstallContextValue>,
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByTestId("app-header-install-cta-desktop"),
    ).toHaveTextContent("Install app");
  },
};

export const InstalledWindowChrome: Story = {
  ...DeviceHeaderDesktop,
  parameters: {
    pwaInstall: {
      canPromptInstall: false,
      displayMode: "window-controls-overlay",
      installStatus: "installed",
      isInstalled: true,
      isWindowControlsOverlayVisible: true,
      promptInstall: async () => "unavailable",
    } satisfies Partial<PwaInstallContextValue>,
    route: "/devices/demo-a",
    viewport: { defaultViewport: "isolapurrDesktop" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shell = canvas.getByTestId("app-shell");
    await expect(shell).toHaveAttribute(
      "data-display-mode",
      "window-controls-overlay",
    );
    await expect(shell).toHaveAttribute(
      "data-window-controls-overlay",
      "visible",
    );
    await expect(
      canvas.queryByTestId("app-header-install-cta-desktop"),
    ).not.toBeInTheDocument();
  },
};
