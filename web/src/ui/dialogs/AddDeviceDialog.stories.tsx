import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";

import type { DiscoveredDevice } from "../../domain/discovery";
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
    }, [find]);
    return <Story />;
  };
}

type AgentSnapshot = {
  mode: "service" | "scan";
  status: "idle" | "scanning" | "ready" | "unavailable";
  devices: DiscoveredDevice[];
  error?: string;
  scan?: { cidr: string; done: number; total: number };
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
      return new Response("", { status: 204 });
    }

    if (url.pathname === "/api/v1/discovery/snapshot") {
      return jsonResponse(snapshot);
    }

    if (url.pathname === "/api/v1/discovery/cancel") {
      return new Response("", { status: 204 });
    }

    return original(input, init);
  };
}

function longDevices(count: number): DiscoveredDevice[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      device_id: `isolapurr-hub-${n}`,
      hostname: `hub-${n}`,
      fqdn: `hub-${n}.local`,
      ipv4: `192.168.1.${40 + n}`,
      baseUrl:
        n % 3 === 0
          ? `http://hub-${n}.local/this/is/a/very/long/path/to/trigger/truncation/in/narrow/layouts`
          : `http://hub-${n}.local`,
      firmware: { name: "isolapurr", version: `0.1.${n}` },
      variant: n % 2 === 0 ? "tps-sw" : "ip6557",
      last_seen_at: new Date(Date.now() - n * 60_000).toISOString(),
    };
  });
}

const meta: Meta<typeof AddDeviceDialog> = {
  title: "Dialogs/AddDeviceDialog",
  component: AddDeviceDialog,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    open: true,
    existingDeviceIds: ["isolapurr-hub-1"],
    existingDeviceBaseUrls: ["http://hub-1.local"],
    onClose: () => {},
    onCreate: async () => ({
      ok: true,
      device: { id: "demo", name: "Demo", baseUrl: "http://192.168.1.10" },
    }),
  },
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

export const FormErrors: Story = {
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
      return buttons.find((b) => b.textContent?.trim() === "Create") ?? null;
    }),
  ],
};
