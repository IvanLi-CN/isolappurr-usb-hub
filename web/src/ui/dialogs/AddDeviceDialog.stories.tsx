import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "@storybook/test";
import { useEffect, useLayoutEffect } from "react";
import { MemoryRouter } from "react-router";

import type { DiscoveredDevice } from "../../domain/discovery";
import {
  clearIpScanSession,
  createIpScanSession,
  saveIpScanSession,
} from "../../domain/ipScanSession";
import {
  jsonResponse,
  mockFetchDecorator,
  notFound,
} from "../../stories/storybook/mockFetch";
import { AddDeviceDialog } from "./AddDeviceDialog";

function autoClickDecorator(find: () => HTMLElement | null): Decorator {
  return (Story) => {
    useEffect(() => {
      const id = window.setTimeout(() => {
        find()?.click();
      }, 0);
      return () => window.clearTimeout(id);
    });
    return <Story />;
  };
}

type AgentSnapshot = {
  mode: "service" | "scan";
  status: "idle" | "scanning" | "ready" | "unavailable";
  devices: DiscoveredDevice[];
  error?: string;
  scan?: {
    cidr: string;
    done: number;
    total: number;
    status: "scanning" | "ready";
    devices: DiscoveredDevice[];
    runId?: number;
  };
};

function mockAgent(snapshot: AgentSnapshot) {
  return async (
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
      window.location.origin,
    );

    if (url.pathname === "/api/v1/bootstrap") {
      return jsonResponse({
        token: "demo",
        agentBaseUrl: "http://agent.local",
      });
    }

    if (url.pathname === "/api/v1/discovery/refresh") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/v1/discovery/snapshot") {
      return jsonResponse(snapshot);
    }

    if (url.pathname === "/api/v1/discovery/cancel") {
      return new Response(null, { status: 204 });
    }

    return original(input, init);
  };
}

const desktopScanLifecycleRequests = {
  starts: [] as Array<Record<string, unknown>>,
  cancellations: [] as Array<Record<string, unknown>>,
  ready: false,
};

function desktopScanLifecycleMock(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  original: typeof fetch,
) {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString(),
    window.location.origin,
  );
  if (url.pathname === "/api/v1/bootstrap") {
    return Promise.resolve(
      jsonResponse({ token: "demo", agentBaseUrl: "http://agent.local" }),
    );
  }
  if (url.pathname === "/api/v1/discovery/refresh") {
    desktopScanLifecycleRequests.ready = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  if (url.pathname === "/api/v1/discovery/ip-scan") {
    const body =
      typeof init?.body === "string"
        ? JSON.parse(init.body)
        : Object.create(null);
    desktopScanLifecycleRequests.starts.push(body);
    return Promise.resolve(
      desktopScanLifecycleRequests.starts.length === 1
        ? jsonResponse({ accepted: false }, { status: 202 })
        : jsonResponse({ accepted: true, runId: 9 }, { status: 202 }),
    );
  }
  if (url.pathname === "/api/v1/discovery/cancel") {
    const body =
      typeof init?.body === "string"
        ? JSON.parse(init.body)
        : Object.create(null);
    desktopScanLifecycleRequests.cancellations.push(body);
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  if (url.pathname === "/api/v1/discovery/snapshot") {
    const secondScanActive =
      desktopScanLifecycleRequests.starts.length >= 2 &&
      desktopScanLifecycleRequests.cancellations.length < 2;
    return Promise.resolve(
      jsonResponse({
        mode: "service",
        status: "ready",
        devices: [],
        scan: secondScanActive
          ? {
              cidr: "192.168.1.0/31",
              done: 0,
              total: 2,
              status: "scanning",
              devices: [],
              runId: 9,
            }
          : undefined,
      }),
    );
  }
  return original(input, init);
}

function desktopScanLifecycleDecorator(): Decorator {
  return (Story) => {
    useLayoutEffect(() => {
      clearIpScanSession(false);
      clearIpScanSession(true);
      desktopScanLifecycleRequests.starts = [];
      desktopScanLifecycleRequests.cancellations = [];
      desktopScanLifecycleRequests.ready = false;
    }, []);
    return <Story />;
  };
}

function longDevices(count: number): DiscoveredDevice[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const suffix = (0xaabbcc001100 + n).toString(16).padStart(12, "0");
    return {
      device_id: suffix,
      hostname: `isolapurr-usb-hub-${suffix}`,
      fqdn: `isolapurr-usb-hub-${suffix}.local`,
      ipv4: `192.168.1.${40 + n}`,
      baseUrl: `http://192.168.1.${40 + n}`,
      firmware: { name: "isolapurr-usb-hub", version: `0.1.${n}` },
      variant: "tps-sw",
      last_seen_at: new Date(Date.now() - n * 60_000).toISOString(),
    };
  });
}

function cachedScanDecorator(): Decorator {
  return (Story) => {
    useLayoutEffect(() => {
      saveIpScanSession(
        false,
        createIpScanSession("192.168.31.0/24", longDevices(2)),
      );
      return () => clearIpScanSession(false);
    }, []);
    return <Story />;
  };
}

function clearCachedScanDecorator(): Decorator {
  return (Story) => {
    useLayoutEffect(() => {
      clearIpScanSession(false);
    }, []);
    return <Story />;
  };
}

const meta: Meta<typeof AddDeviceDialog> = {
  title: "Dialogs/AddDeviceDialog",
  component: AddDeviceDialog,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    open: true,
    existingDeviceIds: ["aabbcc001101"],
    existingDeviceBaseUrls: ["http://192.168.1.41"],
    onClose: () => {},
    onCreate: async () => ({
      ok: true,
      device: { id: "demo", name: "Demo", baseUrl: "http://192.168.1.10" },
    }),
    onUpsert: async () => ({
      ok: true,
      device: { id: "demo", name: "Demo", baseUrl: "http://192.168.1.10" },
    }),
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof AddDeviceDialog>;

export const Unavailable: Story = {
  decorators: [
    mockFetchDecorator(async (input, init, original) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString(),
        window.location.origin,
      );
      if (url.pathname === "/api/v1/bootstrap") {
        return notFound();
      }
      return original(input, init);
    }),
  ],
};

export const Scanning: Story = {
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "scanning",
        devices: [],
      }),
    ),
  ],
};

export const Empty: Story = {
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
  ],
};

export const LongList: Story = {
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: longDevices(24),
      }),
    ),
  ],
};

export const ErrorHint: Story = {
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
        error:
          "No devices found yet — try IP scan (advanced) with a CIDR range.",
      }),
    ),
  ],
};

export const MultiResultAdded: Story = {
  decorators: [
    clearCachedScanDecorator(),
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [longDevices(2)[0], longDevices(2)[1]],
      }),
    ),
  ],
};

export const CachedScan: Story = {
  decorators: [
    cachedScanDecorator(),
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
  ],
};

export const IpScanExpanded: Story = {
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
    autoClickDecorator(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.find((b) => b.textContent?.trim() === "Show") ?? null;
    }),
  ],
};

export const DesktopScanLifecycle: Story = {
  decorators: [
    desktopScanLifecycleDecorator(),
    mockFetchDecorator(desktopScanLifecycleMock),
  ],
  play: async ({ canvasElement }) => {
    const findButton = (label: string): HTMLButtonElement | null =>
      Array.from(
        canvasElement.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === label) ?? null;
    const clickButton = async (label: string) => {
      const button = findButton(label);
      if (!button) {
        throw new Error(`Missing ${label} button`);
      }
      await userEvent.click(button);
    };
    await waitFor(() => expect(desktopScanLifecycleRequests.ready).toBe(true));
    desktopScanLifecycleRequests.starts = [];
    desktopScanLifecycleRequests.cancellations = [];
    await clickButton("Show");
    const cidr = canvasElement.querySelector<HTMLInputElement>(
      'input[placeholder="CIDR, e.g. 192.168.1.0/24"]',
    );
    if (!cidr) {
      throw new Error("Missing CIDR input");
    }
    await userEvent.clear(cidr);
    await userEvent.type(cidr, "192.168.1.0/31");
    await clickButton("Scan");
    await waitFor(() =>
      expect(desktopScanLifecycleRequests.starts).toHaveLength(1),
    );
    await waitFor(() =>
      expect(desktopScanLifecycleRequests.cancellations).toHaveLength(1),
    );
    await expect(desktopScanLifecycleRequests.starts[0].requestId).toEqual(
      expect.any(String),
    );
    await expect(
      desktopScanLifecycleRequests.cancellations[0].requestId,
    ).toEqual(desktopScanLifecycleRequests.starts[0].requestId);

    await clickButton("Scan");
    await waitFor(() =>
      expect(desktopScanLifecycleRequests.starts).toHaveLength(2),
    );
    await clickButton("Cancel");
    await waitFor(() =>
      expect(desktopScanLifecycleRequests.cancellations).toHaveLength(2),
    );
    await expect(desktopScanLifecycleRequests.cancellations[1]).toEqual({
      runId: 9,
    });
  },
};

export const AddFailure: Story = {
  args: {
    onCreate: async () => ({
      ok: false,
      errors: { baseUrl: "Device already exists." },
    }),
  },
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [
          {
            device_id: "aabbcc001102",
            hostname: "isolapurr-usb-hub-aabbcc001102",
            fqdn: "isolapurr-usb-hub-aabbcc001102.local",
            ipv4: "192.168.1.42",
            baseUrl: "http://192.168.1.42",
            firmware: { name: "isolapurr-usb-hub", version: "0.1.2" },
            variant: "tps-sw",
          },
        ],
      }),
    ),
    autoClickDecorator(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      return buttons.find((b) => b.textContent?.trim() === "Add") ?? null;
    }),
  ],
};

export const WebSerialSetup: Story = {
  args: {
    initialMethod: "web_serial",
  },
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
  ],
};

export const WebSerialConnectionLog: Story = {
  args: {
    initialMethod: "web_serial",
    initialUsbLog: [
      { tone: "info", message: "Requesting browser serial access..." },
      {
        tone: "info",
        message: "Browser serial port opened. Reading connected hub...",
      },
      {
        tone: "warning",
        message:
          "Web Serial info attempt failed: No IsolaPurr JSONL response received from this serial device.",
      },
      {
        tone: "info",
        message: "Sending info request over Web Serial (attempt 2/3)...",
      },
      {
        tone: "success",
        message: "Wi-Fi HTTP link verified and will be saved.",
      },
    ],
  },
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
  ],
};

export const LocalUsbSetup: Story = {
  args: {
    initialMethod: "local_usb",
  },
  decorators: [
    mockFetchDecorator(
      mockAgent({
        mode: "service",
        status: "ready",
        devices: [],
      }),
    ),
  ],
};
