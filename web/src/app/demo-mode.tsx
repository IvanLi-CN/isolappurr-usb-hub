import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { DEMO_AGENT_BASE_URL, DEMO_AGENT_TOKEN } from "../domain/desktopAgent";
import type {
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  WifiConfigResponse,
} from "../domain/deviceApi";
import type { AddDeviceInput, StoredDevice } from "../domain/devices";
import type { DiscoverySnapshot } from "../domain/discovery";
import type { PortsResponse } from "../domain/ports";
import {
  buildDefaultDemoPowerConfig,
  clearDemoWorld,
  cloneWorld,
  createCanonicalDemoWorld,
  DEMO_OWNER,
  type DemoDeviceRecord,
  type DemoWorld,
  demoStoredDevices,
  findByBaseUrl,
  findByDeviceId,
  makeManualDemoDevice,
  readDemoEnabled,
  readDemoWorld,
  removeDemoDevice,
  upsertDemoDevice,
  writeDemoEnabled,
  writeDemoWorld,
} from "./demo-mode-world";
import type { ThemeId } from "./theme";

let demoFetchRestore: (() => void) | null = null;

const DEMO_ENABLED_STORAGE_KEY = "isolapurr.demo.enabled";
export const DEMO_ENTER_QUERY = "?demo=true";
export const DEMO_EXIT_QUERY = "?demo=false";
void DEMO_ENABLED_STORAGE_KEY;

export {
  DEMO_RESET_EVENT,
  readDemoWorldSummary,
  resetDemoModeSession,
} from "./demo-mode-world";

type DemoModeContextValue = {
  enabled: boolean;
  query: string;
  withDemoSearch: (to: string) => string;
  exitHref: string;
  bootstrap: (pathname: string, search: string) => void;
  clear: () => void;
};

type DemoAgentResponse = {
  token: string;
  agentBaseUrl: string;
  app: { name: string; version: string; mode: string };
};

type DemoStorageDevicesResponse = {
  devices: StoredDevice[];
};

type DemoStorageDeviceResponse = {
  device: StoredDevice;
};

type DemoStorageSettingsResponse = {
  settings: { theme: ThemeId };
};

type DemoStorageExportResponse = {
  schema_version: number;
  devices: StoredDevice[];
  settings: { theme?: ThemeId };
  meta: Record<string, never>;
};

type DemoDiscoverySnapshotResponse = DiscoverySnapshot;

type DemoApiResponse =
  | DemoAgentResponse
  | DemoStorageDevicesResponse
  | DemoStorageDeviceResponse
  | DemoStorageSettingsResponse
  | DemoStorageExportResponse
  | DemoDiscoverySnapshotResponse
  | DeviceInfoResponse
  | PortsResponse
  | WifiConfigResponse
  | PowerConfigResponse
  | PdDiagnosticsResponse
  | IdleBiasResponse
  | {
      accepted: true;
      power_enabled?: boolean;
      persisted?: boolean;
      usb_c_downstream_route?: "mcu" | "usb_c";
      reboot_required?: boolean;
      scope?: "wifi" | "other";
      wifi_preserved?: boolean;
    }
  | { migrated: boolean; imported?: { devices: number; settings: boolean } };

const DEMO_MODE_DISABLED: DemoModeContextValue = {
  enabled: false,
  query: "",
  withDemoSearch: (to) => to,
  exitHref: `/${DEMO_EXIT_QUERY}`,
  bootstrap: () => {},
  clear: () => {},
};

const DemoModeContext = createContext<DemoModeContextValue>(DEMO_MODE_DISABLED);

function jsonResponse(body: DemoApiResponse, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        retryable: false,
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

function applyRuntimePowerMutation(
  power: PowerConfigResponse,
  action: "output" | "discharge",
  enabled: boolean,
): PowerConfigResponse {
  const nextRuntime = {
    output_enabled: power.runtime?.output_enabled ?? true,
    discharge_enabled: power.runtime?.discharge_enabled ?? false,
  };
  if (action === "output") {
    nextRuntime.output_enabled = enabled;
  } else {
    nextRuntime.discharge_enabled = enabled;
  }
  return {
    ...power,
    runtime: nextRuntime,
  };
}

function parseRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(
      input,
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost",
    );
  }
  return new URL(
    input.url,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );
}

function readJsonBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (typeof body !== "string" || body.length === 0) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function coerceTheme(value: unknown): ThemeId {
  return value === "isolapurr-dark" || value === "system" ? value : "isolapurr";
}

function requestMethod(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

function isDemoAgentUrl(url: URL): boolean {
  return url.origin === DEMO_AGENT_BASE_URL;
}

function isDemoDeviceUrl(url: URL): boolean {
  const origin = url.origin;
  if (origin === "null") {
    return false;
  }
  const world = readDemoWorld();
  return world.devices.some(
    (device) =>
      device.stored.baseUrl === origin ||
      device.stored.transports?.httpBaseUrl === origin,
  );
}

function updateWorld(mutator: (world: DemoWorld) => DemoWorld): DemoWorld {
  const next = mutator(readDemoWorld());
  writeDemoWorld(next);
  return next;
}

function resolveDeviceFromUrl(
  world: DemoWorld,
  url: URL,
): DemoDeviceRecord | null {
  return findByBaseUrl(world, url.origin) ?? null;
}

function handleDemoStorageRequest(url: URL, init?: RequestInit): Response {
  const method = requestMethod(init);
  if (url.pathname === "/api/v1/storage/devices" && method === "GET") {
    return jsonResponse({ devices: demoStoredDevices(readDemoWorld()) });
  }
  if (url.pathname === "/api/v1/storage/devices" && method === "POST") {
    const body = readJsonBody(init) as { device?: AddDeviceInput } | null;
    const input = body?.device;
    if (!input || typeof input !== "object") {
      return apiError(400, "invalid_request", "device is required");
    }
    const next = updateWorld((world) => {
      const existing = input.id ? findByDeviceId(world, input.id) : undefined;
      const record = existing
        ? makeManualDemoDevice(world, {
            ...input,
            id: existing.stored.id,
          })
        : makeManualDemoDevice(world, input);
      return upsertDemoDevice(
        {
          ...world,
          nextManualId: existing ? world.nextManualId : world.nextManualId + 1,
          nextManualIpOctet: existing
            ? world.nextManualIpOctet
            : world.nextManualIpOctet + 1,
        },
        record,
      );
    });
    const inputId = typeof input.id === "string" ? input.id : undefined;
    const created =
      (inputId && findByDeviceId(next, inputId)) ??
      findByBaseUrl(next, input.baseUrl);
    if (!created) {
      return apiError(
        500,
        "demo_create_failed",
        "Could not create demo device",
      );
    }
    return jsonResponse({ device: created.stored });
  }
  if (
    url.pathname.startsWith("/api/v1/storage/devices/") &&
    method === "DELETE"
  ) {
    const deviceId = decodeURIComponent(
      url.pathname.replace("/api/v1/storage/devices/", ""),
    );
    updateWorld((world) => removeDemoDevice(world, deviceId));
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/api/v1/storage/settings" && method === "GET") {
    return jsonResponse({ settings: { theme: readDemoWorld().theme } });
  }
  if (url.pathname === "/api/v1/storage/settings" && method === "PUT") {
    const body = readJsonBody(init) as {
      settings?: { theme?: unknown };
    } | null;
    const next = updateWorld((world) => ({
      ...world,
      theme: coerceTheme(body?.settings?.theme),
    }));
    return jsonResponse({ settings: { theme: next.theme } });
  }
  if (
    url.pathname === "/api/v1/storage/migrate/localstorage" &&
    method === "POST"
  ) {
    return jsonResponse({
      migrated: false,
      imported: { devices: 0, settings: false },
    });
  }
  if (url.pathname === "/api/v1/storage/export" && method === "GET") {
    const world = readDemoWorld();
    return jsonResponse({
      schema_version: 1,
      devices: demoStoredDevices(world),
      settings: { theme: world.theme },
      meta: {},
    });
  }
  if (url.pathname === "/api/v1/storage/reset" && method === "POST") {
    const next = createCanonicalDemoWorld();
    writeDemoWorld(next);
    return new Response(null, { status: 204 });
  }
  return apiError(404, "not_found", "Demo storage endpoint not found");
}

function handleDemoDiscoveryRequest(url: URL, init?: RequestInit): Response {
  const method = requestMethod(init);
  if (url.pathname === "/api/v1/discovery/refresh" && method === "POST") {
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/api/v1/discovery/snapshot" && method === "GET") {
    return jsonResponse(readDemoWorld().discovery);
  }
  if (url.pathname === "/api/v1/discovery/ip-scan" && method === "POST") {
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/api/v1/discovery/cancel" && method === "POST") {
    return new Response(null, { status: 204 });
  }
  return apiError(404, "not_found", "Demo discovery endpoint not found");
}

function handleDemoLocalUsbRequest(url: URL, init?: RequestInit): Response {
  const method = requestMethod(init);
  const world = readDemoWorld();

  if (url.pathname === "/api/v1/devices/scan" && method === "POST") {
    return jsonResponse({
      devices: world.devices.map((device) => ({
        id: device.stored.id,
        usb:
          device.stored.demoTransport === "local_usb"
            ? {
                portPath:
                  device.stored.transports?.localUsbPortPath ??
                  `/dev/demo-${device.stored.id}`,
                label: `${device.stored.name} (demo)`,
                vendorId: 0x303a,
                productId: 0x1001,
                serialNumber: device.stored.id,
              }
            : undefined,
      })),
    } as unknown as DemoApiResponse);
  }

  if (url.pathname === "/api/v1/serial/ports" && method === "GET") {
    return jsonResponse({
      ports: world.devices
        .filter((device) => device.stored.demoTransport === "local_usb")
        .map((device) => ({
          path:
            device.stored.transports?.localUsbPortPath ??
            `/dev/demo-${device.stored.id}`,
          label: `${device.stored.name} (demo)`,
          vendorId: 0x303a,
          productId: 0x1001,
          serialNumber: device.stored.id,
        })),
    } as unknown as DemoApiResponse);
  }

  if (url.pathname === "/api/v1/serial/request" && method === "POST") {
    const body = readJsonBody(init) as {
      portPath?: string;
      request?: { method?: string };
    } | null;
    const device = world.devices.find(
      (item) =>
        item.stored.transports?.localUsbPortPath === body?.portPath ||
        `/dev/demo-${item.stored.id}` === body?.portPath,
    );
    if (!device) {
      return apiError(404, "not_found", "Demo Local USB port not found");
    }
    if (body?.request?.method === "info") {
      return jsonResponse({
        response: {
          ok: true,
          result: {
            device: {
              device_id: device.stored.id,
              hostname: device.info.device.hostname,
              fqdn: device.info.device.fqdn,
              mac: device.info.device.mac,
              firmware: device.info.device.firmware,
              wifi: { ipv4: device.info.device.wifi.ipv4 },
            },
          },
        },
      } as unknown as DemoApiResponse);
    }
  }

  const deviceMatch = url.pathname.match(/^\/api\/v1\/devices\/([^/]+)\/(.*)$/);
  if (!deviceMatch) {
    return apiError(404, "not_found", "Demo Local USB endpoint not found");
  }
  const [, rawDeviceId, suffix] = deviceMatch;
  const deviceId = decodeURIComponent(rawDeviceId);
  const record = findByDeviceId(world, deviceId);
  if (!record) {
    return apiError(404, "not_found", "Demo Local USB device not found");
  }

  if (suffix === "status" && method === "GET") {
    return jsonResponse({
      response: record.info,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "ports" && method === "GET") {
    return jsonResponse({
      response: record.ports,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "wifi" && method === "GET") {
    return jsonResponse({
      response: record.wifi,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "wifi" && method === "POST") {
    const body = readJsonBody(init) as { ssid?: string; psk?: string } | null;
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.wifi = {
          ...target.wifi,
          configured: true,
          ssid: body?.ssid ?? target.wifi.ssid,
          psk_configured: Boolean(body?.psk),
          state: "connected",
          ipv4: target.info.device.wifi.ipv4,
        };
      }
      return mutated;
    });
    return jsonResponse({
      response: {
        accepted: true,
        reboot_required: false,
      },
    } as unknown as DemoApiResponse);
  }
  if (suffix === "wifi" && method === "DELETE") {
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.wifi = {
          ...target.wifi,
          configured: false,
          ssid: undefined,
          psk_configured: false,
          state: "idle",
          ipv4: null,
        };
        target.info.device.wifi = {
          state: "idle",
          ipv4: null,
          is_static: false,
        };
      }
      return mutated;
    });
    return jsonResponse({
      response: { accepted: true, reboot_required: false },
    } as unknown as DemoApiResponse);
  }
  if (suffix === "settings/reset" && method === "POST") {
    const body = readJsonBody(init) as { scope?: "wifi" | "other" } | null;
    if (body?.scope === "wifi") {
      updateWorld((current) => {
        const mutated = cloneWorld(current);
        const target = findByDeviceId(mutated, deviceId);
        if (target) {
          target.wifi = {
            ...target.wifi,
            configured: false,
            ssid: undefined,
            psk_configured: false,
            state: "idle",
            ipv4: null,
          };
          target.info.device.wifi = {
            state: "idle",
            ipv4: null,
            is_static: false,
          };
        }
        return mutated;
      });
      return jsonResponse({
        response: { accepted: true, scope: "wifi", reboot_required: false },
      } as unknown as DemoApiResponse);
    }
    return jsonResponse({
      response: { accepted: true, scope: "other", wifi_preserved: true },
    } as unknown as DemoApiResponse);
  }
  if (suffix === "reset" && method === "POST") {
    return jsonResponse({
      response: { accepted: true },
    } as unknown as DemoApiResponse);
  }
  if (
    suffix.startsWith("ports/") &&
    suffix.endsWith("/power") &&
    method === "POST"
  ) {
    const portId = suffix.includes("port_a") ? "port_a" : "port_c";
    const enabled = url.searchParams.get("enabled") === "1";
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      const port = target?.ports.ports.find((item) => item.portId === portId);
      if (port) {
        port.state.power_enabled = enabled;
      }
      return mutated;
    });
    return jsonResponse({
      response: { accepted: true, power_enabled: enabled },
    } as unknown as DemoApiResponse);
  }
  if (
    suffix.startsWith("ports/") &&
    suffix.endsWith("/replug") &&
    method === "POST"
  ) {
    return jsonResponse({
      response: { accepted: true },
    } as unknown as DemoApiResponse);
  }
  if (suffix === "hub/route" && method === "POST") {
    const body = readJsonBody(init) as { route?: "mcu" | "usb_c" } | null;
    const route = body?.route === "mcu" ? "mcu" : "usb_c";
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target?.ports.hub) {
        target.ports.hub.usb_c_downstream_route = route;
        target.ports.hub.usb_c_downstream_persisted = true;
      }
      return mutated;
    });
    return jsonResponse({
      response: {
        accepted: true,
        usb_c_downstream_route: route,
        persisted: true,
      },
    } as unknown as DemoApiResponse);
  }
  if (suffix === "pd-diagnostics" && method === "GET") {
    return jsonResponse({
      response: record.pdDiagnostics,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/config" && method === "GET") {
    return jsonResponse({
      response: record.power,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/config" && method === "PUT") {
    const body = readJsonBody(init) as PowerConfigResponse | null;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target && body) {
        target.power = { ...target.power, ...body };
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.power ?? record.power,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/config/defaults" && method === "POST") {
    const defaults = buildDefaultDemoPowerConfig(record);
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.power = defaults;
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.power ?? defaults,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/runtime" && (method === "POST" || method === "PUT")) {
    const body = readJsonBody(init) as {
      action?: "output" | "discharge";
      enabled?: boolean;
    } | null;
    if (
      (body?.action !== "output" && body?.action !== "discharge") ||
      typeof body?.enabled !== "boolean"
    ) {
      return apiError(
        400,
        "bad_request",
        "missing or invalid power runtime command",
      );
    }
    const action = body.action;
    const enabled = body.enabled;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.power = applyRuntimePowerMutation(target.power, action, enabled);
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.power ?? record.power,
    } as unknown as DemoApiResponse);
  }
  if (
    (suffix === "power/config/lock" || suffix === "power/config/release") &&
    method === "POST"
  ) {
    const acquire = suffix.endsWith("lock");
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.power.lock = acquire
          ? { owner: DEMO_OWNER, expires_at_ms: Date.now() + 60_000 }
          : null;
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.power ?? record.power,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/idle-bias" && method === "GET") {
    return jsonResponse({
      response: record.idleBias,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/idle-bias" && method === "PUT") {
    const body = readJsonBody(init) as { correction_enabled?: boolean } | null;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.idleBias.correction_enabled = Boolean(body?.correction_enabled);
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.idleBias ?? record.idleBias,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/idle-bias/run" && method === "POST") {
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.idleBias.run = {
          state: "idle",
          completed_points: target.idleBias.dataset.point_count,
          point_count: target.idleBias.dataset.point_count,
          target_voltage_mv: null,
          error: null,
        };
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.idleBias ?? record.idleBias,
    } as unknown as DemoApiResponse);
  }
  if (suffix === "power/idle-bias/clear" && method === "POST") {
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.idleBias.current_applied_offset_ma = null;
      }
      return mutated;
    });
    return jsonResponse({
      response: findByDeviceId(next, deviceId)?.idleBias ?? record.idleBias,
    } as unknown as DemoApiResponse);
  }

  return apiError(404, "not_found", "Demo Local USB endpoint not found");
}

function handleDemoBootstrapRequest(url: URL): Response {
  if (url.pathname !== "/api/v1/bootstrap") {
    return apiError(404, "not_found", "Demo bootstrap endpoint not found");
  }
  return jsonResponse({
    token: DEMO_AGENT_TOKEN,
    agentBaseUrl: DEMO_AGENT_BASE_URL,
    app: {
      name: "IsolaPurr Demo Agent",
      version: "demo",
      mode: "demo",
    },
  });
}

function handleDemoDeviceRequest(url: URL, init?: RequestInit): Response {
  const world = readDemoWorld();
  const record = resolveDeviceFromUrl(world, url);
  if (!record) {
    return apiError(404, "not_found", "Demo device not found");
  }
  const method = requestMethod(init);

  if (url.pathname === "/api/v1/info" && method === "GET") {
    return jsonResponse(record.info);
  }
  if (url.pathname === "/api/v1/ports" && method === "GET") {
    return jsonResponse(record.ports);
  }
  if (url.pathname === "/api/v1/wifi" && method === "GET") {
    return jsonResponse(record.wifi);
  }
  if (url.pathname === "/api/v1/wifi/set" && method === "POST") {
    const body = readJsonBody(init) as { ssid?: unknown; psk?: unknown } | null;
    const next = updateWorld((current) => {
      const device = findByDeviceId(current, record.stored.id);
      if (!device) {
        return current;
      }
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (!target) {
        return current;
      }
      target.wifi = {
        ...target.wifi,
        configured: true,
        ssid: typeof body?.ssid === "string" ? body.ssid : target.wifi.ssid,
        psk_configured:
          typeof body?.psk === "string"
            ? body.psk.length > 0
            : target.wifi.psk_configured,
        state: "connected",
        ipv4: target.info.device.wifi.ipv4,
      };
      target.info.device.wifi = {
        state: "connected",
        ipv4: target.info.device.wifi.ipv4,
        is_static: false,
      };
      return mutated;
    });
    void next;
    return jsonResponse({ accepted: true, reboot_required: false });
  }
  if (url.pathname === "/api/v1/wifi/clear" && method === "POST") {
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (!target) {
        return current;
      }
      target.wifi = {
        ...target.wifi,
        configured: false,
        ssid: undefined,
        psk_configured: false,
        state: "idle",
        ipv4: null,
      };
      target.info.device.wifi = {
        state: "idle",
        ipv4: null,
        is_static: false,
      };
      return mutated;
    });
    return jsonResponse({ accepted: true, reboot_required: false });
  }
  if (url.pathname === "/api/v1/settings/reset" && method === "POST") {
    const scope = url.searchParams.get("scope");
    if (scope === "wifi") {
      updateWorld((current) => {
        const mutated = cloneWorld(current);
        const target = findByDeviceId(mutated, record.stored.id);
        if (!target) {
          return current;
        }
        target.wifi = {
          ...target.wifi,
          configured: false,
          ssid: undefined,
          psk_configured: false,
          state: "idle",
          ipv4: null,
        };
        target.info.device.wifi = {
          state: "idle",
          ipv4: null,
          is_static: false,
        };
        return mutated;
      });
      return jsonResponse({
        accepted: true,
        scope: "wifi",
        reboot_required: false,
      });
    }
    return jsonResponse({
      accepted: true,
      scope: "other",
      wifi_preserved: true,
    });
  }
  if (url.pathname === "/api/v1/reboot" && method === "POST") {
    return jsonResponse({ accepted: true });
  }
  if (
    url.pathname.startsWith("/api/v1/ports/") &&
    url.pathname.endsWith("/power") &&
    method === "POST"
  ) {
    const portId = url.pathname.includes("/port_a/") ? "port_a" : "port_c";
    const enabled = url.searchParams.get("enabled") === "1";
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      const port = target?.ports.ports.find((item) => item.portId === portId);
      if (port) {
        port.state.power_enabled = enabled;
      }
      return mutated;
    });
    return jsonResponse({ accepted: true, power_enabled: enabled });
  }
  if (
    url.pathname.startsWith("/api/v1/ports/") &&
    url.pathname.endsWith("/actions/replug") &&
    method === "POST"
  ) {
    return jsonResponse({ accepted: true });
  }
  if (
    url.pathname === "/api/v1/hub/usb-c-downstream-route" &&
    method === "POST"
  ) {
    const route = url.searchParams.get("route") === "mcu" ? "mcu" : "usb_c";
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target?.ports.hub) {
        target.ports.hub.usb_c_downstream_route = route;
        target.ports.hub.usb_c_downstream_persisted = true;
      }
      return mutated;
    });
    return jsonResponse({
      accepted: true,
      usb_c_downstream_route: route,
      persisted: true,
    });
  }
  if (url.pathname === "/api/v1/power/config" && method === "GET") {
    return jsonResponse(record.power);
  }
  if (url.pathname === "/api/v1/pd-diagnostics" && method === "GET") {
    return jsonResponse(record.pdDiagnostics);
  }
  if (url.pathname === "/api/v1/power/config" && method === "PUT") {
    const body = readJsonBody(init) as PowerConfigResponse | null;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target && body) {
        target.power = {
          ...target.power,
          ...body,
        };
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.power ?? record.power,
    );
  }
  if (url.pathname === "/api/v1/power/config/defaults" && method === "POST") {
    const defaults = buildDefaultDemoPowerConfig(record);
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.power = defaults;
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.power ?? defaults,
    );
  }
  if (
    url.pathname === "/api/v1/power/runtime" &&
    (method === "POST" || method === "PUT")
  ) {
    const body = readJsonBody(init) as {
      action?: "output" | "discharge";
      enabled?: boolean;
    } | null;
    if (
      (body?.action !== "output" && body?.action !== "discharge") ||
      typeof body?.enabled !== "boolean"
    ) {
      return apiError(
        400,
        "bad_request",
        "missing or invalid power runtime command",
      );
    }
    const action = body.action;
    const enabled = body.enabled;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.power = applyRuntimePowerMutation(target.power, action, enabled);
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.power ?? record.power,
    );
  }
  if (
    (url.pathname === "/api/v1/power/config/lock" ||
      url.pathname === "/api/v1/power/config/release") &&
    method === "POST"
  ) {
    const acquire = url.pathname.endsWith("/lock");
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.power.lock = acquire
          ? { owner: DEMO_OWNER, expires_at_ms: Date.now() + 60_000 }
          : null;
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.power ?? record.power,
    );
  }
  if (url.pathname === "/api/v1/power/idle-bias" && method === "GET") {
    return jsonResponse(record.idleBias);
  }
  if (url.pathname === "/api/v1/power/idle-bias" && method === "PUT") {
    const body = readJsonBody(init) as { correction_enabled?: boolean } | null;
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.idleBias.correction_enabled = Boolean(body?.correction_enabled);
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.idleBias ?? record.idleBias,
    );
  }
  if (url.pathname === "/api/v1/power/idle-bias/run" && method === "POST") {
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.idleBias.run = {
          state: "idle",
          completed_points: target.idleBias.dataset.point_count,
          point_count: target.idleBias.dataset.point_count,
          target_voltage_mv: null,
          error: null,
        };
        target.idleBias.current_applied_offset_ma = 5;
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.idleBias ?? record.idleBias,
    );
  }
  if (url.pathname === "/api/v1/power/idle-bias/clear" && method === "POST") {
    const next = updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, record.stored.id);
      if (target) {
        target.idleBias.current_applied_offset_ma = null;
      }
      return mutated;
    });
    return jsonResponse(
      findByDeviceId(next, record.stored.id)?.idleBias ?? record.idleBias,
    );
  }
  return apiError(404, "not_found", "Demo device endpoint not found");
}

export function isDemoModeEnabled(): boolean {
  return readDemoEnabled();
}

export function initDemoMode(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  const flag = params.get("demo");
  if (flag === "true") {
    writeDemoEnabled(true);
    void readDemoWorld();
    return true;
  }
  if (flag === "false") {
    clearDemoMode();
    return false;
  }
  void pathname;
  return readDemoEnabled();
}

export function clearDemoMode(): void {
  writeDemoEnabled(false);
  clearDemoWorld();
}

export function withDemoSearch(pathname: string, enabled: boolean): string {
  if (!enabled) {
    if (pathname === "/") {
      return `/${DEMO_EXIT_QUERY}`;
    }
    return pathname;
  }
  const url = new URL(pathname, "https://demo.local");
  url.searchParams.set("demo", "true");
  return `${url.pathname}${url.search}`;
}

export function installDemoFetchInterceptor(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isDemoModeEnabled()) {
      return originalFetch(input, init);
    }

    const url = parseRequestUrl(input);
    if (
      (url.pathname === "/api/v1/bootstrap" &&
        (url.origin === window.location.origin || isDemoAgentUrl(url))) ||
      (isDemoAgentUrl(url) && url.pathname.startsWith("/api/v1/")) ||
      isDemoDeviceUrl(url)
    ) {
      if (url.pathname === "/api/v1/bootstrap") {
        return handleDemoBootstrapRequest(url);
      }
      if (isDemoAgentUrl(url) && url.pathname.startsWith("/api/v1/storage/")) {
        return handleDemoStorageRequest(url, init);
      }
      if (
        isDemoAgentUrl(url) &&
        url.pathname.startsWith("/api/v1/discovery/")
      ) {
        return handleDemoDiscoveryRequest(url, init);
      }
      if (isDemoAgentUrl(url) && url.pathname.startsWith("/api/v1/devices")) {
        return handleDemoLocalUsbRequest(url, init);
      }
      if (isDemoAgentUrl(url) && url.pathname.startsWith("/api/v1/serial/")) {
        return handleDemoLocalUsbRequest(url, init);
      }
      if (isDemoDeviceUrl(url)) {
        return handleDemoDeviceRequest(url, init);
      }
    }

    if (isDemoModeEnabled() && url.pathname === "/api/v1/bootstrap") {
      return handleDemoBootstrapRequest(url);
    }

    return originalFetch(input, init);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

export function ensureDemoFetchInterceptor(): void {
  if (demoFetchRestore) {
    return;
  }
  demoFetchRestore = installDemoFetchInterceptor();
}

function resolveInitialDemoEnabled(): boolean {
  const enabled = initDemoMode(
    typeof window !== "undefined" ? window.location.pathname : "/",
    typeof window !== "undefined" ? window.location.search : "",
  );
  if (enabled) {
    ensureDemoFetchInterceptor();
  }
  return enabled;
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(resolveInitialDemoEnabled);

  useEffect(() => {
    setEnabled(readDemoEnabled());
  }, []);

  useLayoutEffect(() => {
    ensureDemoFetchInterceptor();
    return () => undefined;
  }, []);

  const value = useMemo<DemoModeContextValue>(() => {
    const query = enabled ? DEMO_ENTER_QUERY : "";
    return {
      enabled,
      query,
      withDemoSearch: (to) => withDemoSearch(to, enabled),
      exitHref: `/${DEMO_EXIT_QUERY}`,
      bootstrap: (pathname, search) => {
        const nextEnabled = initDemoMode("/", search);
        if (nextEnabled) {
          ensureDemoFetchInterceptor();
        }
        setEnabled(nextEnabled);
        void pathname;
      },
      clear: () => {
        clearDemoMode();
        setEnabled(false);
      },
    };
  }, [enabled]);

  return (
    <DemoModeContext.Provider value={value}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode(): DemoModeContextValue {
  return useContext(DemoModeContext);
}
