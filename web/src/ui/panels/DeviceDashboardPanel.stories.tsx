import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";

import { DeviceRuntimeProvider } from "../../app/device-runtime";
import { DevicesProvider } from "../../app/devices-store";
import type { PdDiagnosticsResponse } from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";
import {
  jsonResponse,
  mockFetchDecorator,
} from "../../stories/storybook/mockFetch";
import { ToastProvider } from "../toast/ToastProvider";
import { DeviceDashboardPanel } from "./DeviceDashboardPanel";

const demoDevice: StoredDevice = {
  id: "aabbcc001122",
  name: "Desk Hub A",
  baseUrl: "http://isolapurr-usb-hub-aabbcc001122.local",
};

const legacyDevice: StoredDevice = {
  id: "bbccdd112233",
  name: "Legacy Hub",
  baseUrl: "http://isolapurr-usb-hub-bbccdd112233.local",
};

const mcuRouteDevice: StoredDevice = {
  id: "ccddee223344",
  name: "MCU Routed Hub",
  baseUrl: "http://isolapurr-usb-hub-ccddee223344.local",
};

const manualFocusDevice: StoredDevice = {
  id: "ddee33445566",
  name: "Manual Focus Hub",
  baseUrl: "http://isolapurr-usb-hub-ddee33445566.local",
};

const manualOnDevice: StoredDevice = {
  id: "eeff44556677",
  name: "Manual On Hub",
  baseUrl: "http://isolapurr-usb-hub-eeff44556677.local",
};

const manualOffDevice: StoredDevice = {
  id: "ff0055667788",
  name: "Manual Off Hub",
  baseUrl: "http://isolapurr-usb-hub-ff0055667788.local",
};

const telemetryErrorDevice: StoredDevice = {
  id: "aa1166778899",
  name: "Telemetry Error Hub",
  baseUrl: "http://isolapurr-usb-hub-aa1166778899.local",
};

const autoPdDiagnostics: PdDiagnosticsResponse = {
  usb_c_power_enabled: true,
  sw2303_i2c_allowed: true,
  sw2303_profile_applied: true,
  sw2303_stable_reads: 120,
  sw2303_error_latched: false,
  tps_error_latched: false,
  sw2303_readback_config: {
    available: true,
    matches_config: true,
    power_watts: 100,
    protocols: {
      pd: true,
      qc20: true,
      qc30: true,
      fcp: true,
      afc: true,
      scp: true,
      pe20: true,
      bc12: true,
      sfcp: true,
    },
    pd: {
      pps: true,
      fixed_voltages_mv: [9000, 12000, 15000, 20000],
    },
  },
  sw2303_request: { mv: 9000, ma: 3000 },
  sw2303_vbus_mv: 9000,
  sw2303_last_valid_request: { mv: 9000, ma: 3000 },
  display: {
    mode: { kind: "pd", label: "PD" },
    measurements_visible: true,
    badge: { kind: "voltage", label: "9V" },
  },
  usb_c_actual: {
    status: "ok",
    voltage_mv: 9000,
    current_ma: 310,
    power_mw: 2790,
    sample_uptime_ms: 123_456,
  },
  tps_setpoint: {
    output_enabled: false,
    mv: null,
    iout_limit_ma: null,
  },
  tps_iout_limit_readback: {
    enabled: null,
    ma: null,
  },
  runtime_recovery_count: 0,
  sample_uptime_ms: 123_456,
};

const manualFocusDiagnostics: PdDiagnosticsResponse = {
  ...autoPdDiagnostics,
  display: {
    mode: { kind: "dc", label: "3.30V" },
    measurements_visible: true,
    badge: { kind: "focus", label: "FOCUS" },
  },
  usb_c_actual: {
    status: "ok",
    voltage_mv: 5011,
    current_ma: 0,
    power_mw: 3,
    sample_uptime_ms: 123_456,
  },
  tps_setpoint: {
    output_enabled: true,
    mv: 3300,
    iout_limit_ma: 3000,
  },
  tps_iout_limit_readback: {
    enabled: true,
    ma: 3000,
  },
};

const manualOnDiagnostics: PdDiagnosticsResponse = {
  ...autoPdDiagnostics,
  display: {
    mode: { kind: "dc", label: "9.00V" },
    measurements_visible: true,
    badge: { kind: "on", label: "ON" },
  },
  usb_c_actual: {
    status: "ok",
    voltage_mv: 9012,
    current_ma: 812,
    power_mw: 7318,
    sample_uptime_ms: 123_456,
  },
  tps_setpoint: {
    output_enabled: true,
    mv: 9000,
    iout_limit_ma: 3000,
  },
  tps_iout_limit_readback: {
    enabled: true,
    ma: 3000,
  },
};

const manualOffDiagnostics: PdDiagnosticsResponse = {
  ...autoPdDiagnostics,
  display: {
    mode: { kind: "dc", label: "9.00V" },
    measurements_visible: true,
    badge: { kind: "off", label: "OFF" },
  },
  sw2303_vbus_mv: 0,
  usb_c_actual: {
    status: "ok",
    voltage_mv: 0,
    current_ma: 0,
    power_mw: 0,
    sample_uptime_ms: 123_456,
  },
  tps_setpoint: {
    output_enabled: true,
    mv: 9000,
    iout_limit_ma: 3000,
  },
  tps_iout_limit_readback: {
    enabled: true,
    ma: 3000,
  },
};

function mockHub(hostname: string) {
  if (hostname === "isolapurr-usb-hub-bbccdd112233.local") {
    return { upstream_connected: true };
  }
  return {
    upstream_connected: true,
    isolated_usb_fault: false,
    isolated_downstream_connected: true,
    isolated_usb_ready: true,
    usb_c_downstream_route:
      hostname === "isolapurr-usb-hub-ccddee223344.local" ? "mcu" : "usb_c",
    usb_c_downstream_persisted:
      hostname !== "isolapurr-usb-hub-ccddee223344.local",
  };
}

function mockUsbCTelemetry(hostname: string) {
  if (hostname === "isolapurr-usb-hub-ddee33445566.local") {
    return {
      status: "ok",
      voltage_mv: 5011,
      current_ma: 0,
      power_mw: 3,
      sample_uptime_ms: 2345,
    };
  }
  if (hostname === "isolapurr-usb-hub-eeff44556677.local") {
    return {
      status: "ok",
      voltage_mv: 9012,
      current_ma: 812,
      power_mw: 7318,
      sample_uptime_ms: 2345,
    };
  }
  if (hostname === "isolapurr-usb-hub-ff0055667788.local") {
    return {
      status: "ok",
      voltage_mv: 0,
      current_ma: 0,
      power_mw: 0,
      sample_uptime_ms: 2345,
    };
  }
  if (hostname === "isolapurr-usb-hub-aa1166778899.local") {
    return {
      status: "error",
      voltage_mv: null,
      current_ma: null,
      power_mw: null,
      sample_uptime_ms: 2345,
    };
  }
  return {
    status: "ok",
    voltage_mv: 9000,
    current_ma: 310,
    power_mw: 2790,
    sample_uptime_ms: 123_456,
  };
}

function mockUsbCDiagnostics(hostname: string): PdDiagnosticsResponse {
  if (hostname === "isolapurr-usb-hub-ddee33445566.local") {
    return manualFocusDiagnostics;
  }
  if (hostname === "isolapurr-usb-hub-eeff44556677.local") {
    return manualOnDiagnostics;
  }
  if (hostname === "isolapurr-usb-hub-ff0055667788.local") {
    return manualOffDiagnostics;
  }
  return autoPdDiagnostics;
}

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

  const knownHosts = new Set([
    "isolapurr-usb-hub-aabbcc001122.local",
    "isolapurr-usb-hub-bbccdd112233.local",
    "isolapurr-usb-hub-ccddee223344.local",
    "isolapurr-usb-hub-ddee33445566.local",
    "isolapurr-usb-hub-eeff44556677.local",
    "isolapurr-usb-hub-ff0055667788.local",
    "isolapurr-usb-hub-aa1166778899.local",
  ]);

  if (!knownHosts.has(url.hostname)) {
    return original(input, init);
  }

  if (url.pathname === "/api/v1/ports") {
    return jsonResponse({
      hub: mockHub(url.hostname),
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
          telemetry: mockUsbCTelemetry(url.hostname),
          state: {
            power_enabled: true,
            data_connected: false,
            replugging: false,
            busy: false,
          },
          capabilities: { data_replug: true, power_set: true },
        },
      ],
    });
  }

  if (url.pathname === "/api/v1/pd-diagnostics") {
    if (url.hostname === "isolapurr-usb-hub-bbccdd112233.local") {
      return new Response(
        JSON.stringify({
          error: {
            code: "not_found",
            message: "legacy firmware has no pd diagnostics endpoint",
            retryable: false,
          },
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return jsonResponse(mockUsbCDiagnostics(url.hostname));
  }

  if (url.pathname.endsWith("/actions/replug")) {
    return jsonResponse({ accepted: true });
  }

  if (url.pathname.includes("/power")) {
    const enabled = url.searchParams.get("enabled") === "1";
    return jsonResponse({ accepted: true, power_enabled: enabled });
  }

  if (url.pathname === "/api/v1/hub/usb-c-downstream-route") {
    const route = url.searchParams.get("route") === "mcu" ? "mcu" : "usb_c";
    return jsonResponse({
      accepted: true,
      usb_c_downstream_route: route,
      persisted: true,
    });
  }

  return original(input, init);
};

const meta: Meta<typeof DeviceDashboardPanel> = {
  title: "Panels/DeviceDashboardPanel",
  component: DeviceDashboardPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  decorators: [
    mockFetchDecorator(mockDeviceApi),
    (Story, context) => (
      <ToastProvider>
        <DevicesProvider initialDevices={[context.args.device ?? demoDevice]}>
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

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-mode"),
    ).toHaveTextContent(/pd/i);
    await expect(
      canvas.getByTestId("dashboard-usb-c-live-badge"),
    ).toHaveTextContent("9V");
    await expect(
      canvas.queryByText("USB-C source state"),
    ).not.toBeInTheDocument();
  },
};

export const LegacyFirmwareUnknownIsolation: Story = {
  args: {
    device: legacyDevice,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByTestId("port-card-status-port_c")).toHaveTextContent(
        /ok/i,
      ),
    );
    await expect(
      canvas.queryByTestId("dashboard-usb-c-live-mode"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByTestId("dashboard-usb-c-live-badge"),
    ).not.toBeInTheDocument();
  },
};

export const MobileIsolationBadges: Story = {
  parameters: {
    viewport: {
      defaultViewport: "isolapurrNarrow",
    },
  },
};

export const UsbCRouteMcu: Story = {
  args: {
    device: mcuRouteDevice,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Dashboard renders the live USB-C mode and badge inline on the USB-C card while Settings continues to own configuration changes.",
      },
    },
  },
};

export const ManualForceLive: Story = {
  args: {
    device: manualFocusDevice,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const usbCCard = await canvas.findByTestId("port-card-port_c");
    await waitFor(() =>
      expect(
        within(usbCCard).queryByTestId("port-card-status-port_c"),
      ).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-mode"),
    ).toHaveTextContent("3.30V");
    await expect(
      canvas.getByTestId("dashboard-usb-c-live-badge"),
    ).toHaveTextContent("FOCUS");
    await expect(
      canvas.queryByText("USB-C source state"),
    ).not.toBeInTheDocument();
  },
};

export const ManualPathOnLive: Story = {
  args: {
    device: manualOnDevice,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const usbCCard = await canvas.findByTestId("port-card-port_c");
    await waitFor(() =>
      expect(
        within(usbCCard).queryByTestId("port-card-status-port_c"),
      ).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-mode"),
    ).toHaveTextContent("9.00V");
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-badge"),
    ).toHaveTextContent("ON");
    await expect(
      canvas.queryByText("USB-C source state"),
    ).not.toBeInTheDocument();
  },
};

export const ManualPathOffLive: Story = {
  args: {
    device: manualOffDevice,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const usbCCard = await canvas.findByTestId("port-card-port_c");
    await waitFor(() =>
      expect(
        within(usbCCard).queryByTestId("port-card-status-port_c"),
      ).not.toBeInTheDocument(),
    );
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-mode"),
    ).toHaveTextContent("9.00V");
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-badge"),
    ).toHaveTextContent("OFF");
    await expect(await canvas.findByText("0.00V")).toBeVisible();
    await expect(
      canvas.queryByText("USB-C source state"),
    ).not.toBeInTheDocument();
  },
};

export const LiveBadgesKeepErrorStatus: Story = {
  args: {
    device: telemetryErrorDevice,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("dashboard-usb-c-live-mode"),
    ).toHaveTextContent(/pd/i);
    await expect(
      canvas.getByTestId("dashboard-usb-c-live-badge"),
    ).toHaveTextContent("9V");
    await expect(
      canvas.getByTestId("port-card-status-port_c"),
    ).toHaveTextContent(/error/i);
  },
};
