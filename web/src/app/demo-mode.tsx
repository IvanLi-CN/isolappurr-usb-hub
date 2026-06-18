import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigResponse,
  WifiConfigResponse,
} from "../domain/deviceApi";
import {
  type AddDeviceInput,
  normalizeBaseUrl,
  normalizeStoredDeviceId,
  type StoredDevice,
} from "../domain/devices";
import type { DiscoveredDevice, DiscoverySnapshot } from "../domain/discovery";
import type { HubState, Port, PortId, PortsResponse } from "../domain/ports";
import type { ThemeId } from "./theme";

const DEMO_FLAG_KEY = "isolapurr.demo.enabled";
const DEMO_WORLD_KEY = "isolapurr.demo.world";
const DEMO_AGENT_BASE_URL = "https://demo-agent.invalid";
const DEMO_AGENT_TOKEN = "demo-session";
const DEMO_OWNER = 4242;
const DEMO_ENTER_QUERY = "?demo=true";
const DEMO_EXIT_QUERY = "?demo=false";
let demoFetchRestore: (() => void) | null = null;

type DemoStoredDevice = StoredDevice & {
  demoTransport?: "http" | "local_usb";
};

type DemoDeviceRecord = {
  stored: DemoStoredDevice;
  discovery: DiscoveredDevice;
  info: DeviceInfoResponse;
  ports: PortsResponse;
  wifi: WifiConfigResponse;
  power: PowerConfigResponse;
  pdDiagnostics: PdDiagnosticsResponse;
  idleBias: IdleBiasResponse;
};

type DemoWorld = {
  devices: DemoDeviceRecord[];
  discoveryDevices: DiscoveredDevice[];
  discovery: DiscoverySnapshot;
  theme: ThemeId;
  nextManualId: number;
  nextManualIpOctet: number;
};

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

function buildDemoDevice({
  id,
  name,
  baseUrl,
  fqdn,
  ipv4,
  firmwareVersion,
  localUsb = false,
}: {
  id: string;
  name: string;
  baseUrl: string;
  fqdn: string;
  ipv4: string;
  firmwareVersion: string;
  localUsb?: boolean;
}): DemoDeviceRecord {
  const demoTransport = localUsb ? "local_usb" : "http";
  const stored: DemoStoredDevice = {
    id,
    name,
    baseUrl,
    transports: localUsb
      ? {
          httpBaseUrl: baseUrl,
          localUsbPortPath: `/dev/demo-${id}`,
        }
      : { httpBaseUrl: baseUrl },
    lastSeenAt: "2026-06-18T09:00:00.000Z",
    demoTransport,
  };

  const info: DeviceInfoResponse = {
    device: {
      device_id: id,
      hostname: fqdn.replace(".local", ""),
      fqdn,
      mac: `02:de:mo:${id.slice(0, 2)}:${id.slice(2, 4)}:${id.slice(4, 6)}`,
      variant: "isolapurr-usb-hub",
      firmware: { name: "isolapurr-usb-hub", version: firmwareVersion },
      uptime_ms: 9_876_543,
      wifi: {
        state: "connected",
        ipv4,
        is_static: false,
      },
    },
  };

  const hub: HubState = {
    upstream_connected: true,
    isolated_usb_fault: false,
    isolated_downstream_connected: true,
    isolated_usb_ready: true,
    usb_c_downstream_route: "usb_c",
    usb_c_downstream_persisted: true,
  };

  const port = (
    portId: PortId,
    label: string,
    telemetry: { voltage_mv: number; current_ma: number; power_mw: number },
  ): Port => ({
    portId,
    label,
    telemetry: {
      status: "ok",
      voltage_mv: telemetry.voltage_mv,
      current_ma: telemetry.current_ma,
      power_mw: telemetry.power_mw,
      sample_uptime_ms: 9_876_543,
    },
    telemetry_raw: null,
    state: {
      power_enabled: true,
      data_connected: true,
      replugging: false,
      busy: false,
    },
    capabilities: {
      data_replug: true,
      power_set: true,
    },
  });

  return {
    stored,
    discovery: {
      baseUrl,
      device_id: id,
      hostname: info.device.hostname,
      fqdn,
      ipv4,
      variant: info.device.variant,
      firmware: info.device.firmware,
      last_seen_at: stored.lastSeenAt,
    },
    info,
    ports: {
      hub,
      ports: [
        port("port_a", "USB-A", {
          voltage_mv: 5050,
          current_ma: 870,
          power_mw: 4393,
        }),
        port("port_c", "USB-C", {
          voltage_mv: 9000,
          current_ma: 2100,
          power_mw: 18_900,
        }),
      ],
    },
    wifi: {
      configured: true,
      storage: "eeprom",
      address: "0x50",
      ssid: "IsolaPurr Demo Lab",
      psk_configured: true,
      state: "connected",
      ipv4,
      is_static: false,
    },
    power: {
      hardware: "sw2303",
      persisted: true,
      tps_mode: "auto_follow",
      light_load_mode: "pfm",
      capability: {
        profile: "full",
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
      manual: {
        voltage_mv: 5000,
        current_limit_ma: 1000,
        usb_c_path_mode: "default",
      },
      lock: null,
    },
    pdDiagnostics: {
      usb_c_power_enabled: true,
      sw2303_i2c_allowed: true,
      sw2303_profile_applied: true,
      sw2303_stable_reads: 12,
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
      sw2303_request: { mv: 9000, ma: 2000 },
      sw2303_vbus_mv: 9010,
      sw2303_last_valid_request: { mv: 9000, ma: 2000 },
      display: {
        mode: { kind: "pd", label: "PD 9V" },
        measurements_visible: true,
        badge: { kind: "on", label: "ON" },
      },
      usb_c_actual: {
        status: "ok",
        voltage_mv: 9000,
        current_ma: 2100,
        power_mw: 18_900,
        sample_uptime_ms: 9_876_543,
      },
      tps_setpoint: {
        output_enabled: true,
        mv: 9000,
        iout_limit_ma: 2100,
      },
      tps_iout_limit_readback: {
        enabled: true,
        ma: 2100,
      },
      runtime_recovery_count: 0,
      sample_uptime_ms: 9_876_543,
    },
    idleBias: {
      correction_enabled: true,
      dataset: {
        status: "valid",
        min_voltage_mv: 5000,
        max_voltage_mv: 20000,
        step_mv: 500,
        point_count: 31,
        offsets_ma: Array.from({ length: 31 }, (_, idx) =>
          Math.round(Math.sin(idx / 5) * 18),
        ),
      },
      current_applied_offset_ma: 4,
      run: {
        state: "idle",
        completed_points: 31,
        point_count: 31,
        target_voltage_mv: null,
        error: null,
      },
    },
  };
}

function createCanonicalDemoWorld(): DemoWorld {
  const alpha = buildDemoDevice({
    id: "aabbcc001122",
    name: "Bench Hub Alpha",
    baseUrl: "http://192.168.31.42",
    fqdn: "bench-alpha.local",
    ipv4: "192.168.31.42",
    firmwareVersion: "0.8.2-demo",
  });
  const beta = buildDemoDevice({
    id: "ddeecc003344",
    name: "Bench Hub Beta",
    baseUrl: "http://192.168.31.43",
    fqdn: "bench-beta.local",
    ipv4: "192.168.31.43",
    firmwareVersion: "0.8.2-demo",
    localUsb: true,
  });
  const gamma = buildDemoDevice({
    id: "ffeecc005566",
    name: "Bench Hub Gamma",
    baseUrl: "http://192.168.31.44",
    fqdn: "bench-gamma.local",
    ipv4: "192.168.31.44",
    firmwareVersion: "0.8.2-demo",
  });
  const discoveryDevices = [alpha.discovery, beta.discovery, gamma.discovery];
  return {
    devices: [alpha, beta],
    discoveryDevices,
    discovery: {
      mode: "service",
      status: "ready",
      devices: discoveryDevices,
      ipScan: {
        expanded: false,
        defaultCidr: "192.168.31.0/24",
        candidates: [
          {
            cidr: "192.168.31.0/24",
            label: "Primary LAN",
            interface: "en0",
            ipv4: "192.168.31.10",
            primary: true,
          },
        ],
      },
    },
    theme: "isolapurr",
    nextManualId: 0x445566001100,
    nextManualIpOctet: 60,
  };
}

function canUseSessionStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.sessionStorage !== "undefined"
  );
}

function cloneWorld(world: DemoWorld): DemoWorld {
  return JSON.parse(JSON.stringify(world)) as DemoWorld;
}

function readDemoEnabled(): boolean {
  if (!canUseSessionStorage()) {
    return false;
  }
  return window.sessionStorage.getItem(DEMO_FLAG_KEY) === "true";
}

function writeDemoEnabled(enabled: boolean): void {
  if (!canUseSessionStorage()) {
    return;
  }
  if (enabled) {
    window.sessionStorage.setItem(DEMO_FLAG_KEY, "true");
    return;
  }
  window.sessionStorage.removeItem(DEMO_FLAG_KEY);
}

function readDemoWorld(): DemoWorld {
  if (!canUseSessionStorage()) {
    return createCanonicalDemoWorld();
  }
  const raw = window.sessionStorage.getItem(DEMO_WORLD_KEY);
  if (!raw) {
    const initial = createCanonicalDemoWorld();
    writeDemoWorld(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(raw) as DemoWorld;
    if (!parsed || !Array.isArray(parsed.devices)) {
      throw new Error("invalid world");
    }
    return parsed;
  } catch {
    const initial = createCanonicalDemoWorld();
    writeDemoWorld(initial);
    return initial;
  }
}

function writeDemoWorld(world: DemoWorld): void {
  if (!canUseSessionStorage()) {
    return;
  }
  window.sessionStorage.setItem(DEMO_WORLD_KEY, JSON.stringify(world));
}

function clearDemoWorld(): void {
  if (!canUseSessionStorage()) {
    return;
  }
  window.sessionStorage.removeItem(DEMO_WORLD_KEY);
}

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

function demoStoredDevices(world: DemoWorld): StoredDevice[] {
  return world.devices.map((device) => device.stored);
}

function findByDeviceId(
  world: DemoWorld,
  deviceId: string,
): DemoDeviceRecord | undefined {
  return world.devices.find((device) => device.stored.id === deviceId);
}

function findByBaseUrl(
  world: DemoWorld,
  baseUrl: string,
): DemoDeviceRecord | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized.ok) {
    return undefined;
  }
  return world.devices.find(
    (device) =>
      device.stored.baseUrl === normalized.baseUrl ||
      device.stored.transports?.httpBaseUrl === normalized.baseUrl,
  );
}

function upsertDemoDevice(
  world: DemoWorld,
  record: DemoDeviceRecord,
): DemoWorld {
  const next = cloneWorld(world);
  next.devices = next.devices.filter(
    (device) =>
      device.stored.id !== record.stored.id &&
      device.stored.baseUrl !== record.stored.baseUrl,
  );
  next.devices.push(record);
  next.discoveryDevices = next.discoveryDevices.filter((device) => {
    const normalizedId = normalizeStoredDeviceId(device.device_id);
    return (
      normalizedId !== record.stored.id &&
      device.baseUrl !== record.stored.baseUrl
    );
  });
  next.discovery.devices = next.discoveryDevices;
  return next;
}

function removeDemoDevice(world: DemoWorld, deviceId: string): DemoWorld {
  const next = cloneWorld(world);
  const removed = next.devices.find((device) => device.stored.id === deviceId);
  next.devices = next.devices.filter((device) => device.stored.id !== deviceId);
  if (removed) {
    next.discoveryDevices = [
      ...next.discoveryDevices.filter((device) => {
        const normalizedId = normalizeStoredDeviceId(device.device_id);
        return normalizedId !== removed.stored.id;
      }),
      removed.discovery,
    ];
  }
  next.discovery.devices = next.discoveryDevices;
  return next;
}

function makeManualDemoDevice(
  world: DemoWorld,
  input: AddDeviceInput,
): DemoDeviceRecord {
  const id =
    normalizeStoredDeviceId(input.id) ??
    world.nextManualId.toString(16).padStart(12, "0");
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const ipOctet = world.nextManualIpOctet;
  const baseUrl = normalizedBaseUrl.ok
    ? normalizedBaseUrl.baseUrl
    : `http://192.168.31.${ipOctet}`;
  const hostname = input.name.trim().toLowerCase().replaceAll(/\s+/g, "-");
  const record = buildDemoDevice({
    id,
    name: input.name.trim(),
    baseUrl,
    fqdn: `${hostname || `manual-${id.slice(-4)}`}.local`,
    ipv4: `192.168.31.${ipOctet}`,
    firmwareVersion: "0.8.2-demo",
    localUsb: true,
  });
  record.stored.name = input.name.trim();
  record.discovery.baseUrl = baseUrl;
  record.info.device.hostname = hostname || `manual-${id.slice(-4)}`;
  record.info.device.fqdn = record.discovery.fqdn ?? record.info.device.fqdn;
  record.stored.demoTransport = "local_usb";
  record.stored.transports = {
    httpBaseUrl: baseUrl,
    localUsbPortPath: `/dev/demo-${id}`,
    ...input.transports,
  };
  return record;
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
    const defaults = buildDemoDevice({
      id: record.stored.id,
      name: record.stored.name,
      baseUrl: record.stored.baseUrl,
      fqdn: record.info.device.fqdn,
      ipv4: record.info.device.wifi.ipv4 ?? "192.168.31.42",
      firmwareVersion: record.info.device.firmware.version,
      localUsb: true,
    }).power;
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
    const defaults = buildDemoDevice({
      id: record.stored.id,
      name: record.stored.name,
      baseUrl: record.stored.baseUrl,
      fqdn: record.info.device.fqdn,
      ipv4: record.info.device.wifi.ipv4 ?? "192.168.31.42",
      firmwareVersion: record.info.device.firmware.version,
      localUsb: record.stored.demoTransport === "local_usb",
    }).power;
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

export function isDemoDesktopAgent(
  agent: { agentBaseUrl: string; token: string } | null | undefined,
): boolean {
  return (
    Boolean(agent) &&
    agent?.agentBaseUrl === DEMO_AGENT_BASE_URL &&
    agent.token === DEMO_AGENT_TOKEN
  );
}

export function initDemoMode(pathname: string, search: string): boolean {
  const params = new URLSearchParams(search);
  const flag = params.get("demo");
  if (flag === "true") {
    writeDemoEnabled(true);
    if (
      !canUseSessionStorage() ||
      !window.sessionStorage.getItem(DEMO_WORLD_KEY)
    ) {
      writeDemoWorld(createCanonicalDemoWorld());
    }
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

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() =>
    initDemoMode(
      typeof window !== "undefined" ? window.location.pathname : "/",
      typeof window !== "undefined" ? window.location.search : "",
    ),
  );

  useEffect(() => {
    setEnabled(readDemoEnabled());
  }, []);

  useEffect(() => {
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
        setEnabled(initDemoMode("/", search));
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
