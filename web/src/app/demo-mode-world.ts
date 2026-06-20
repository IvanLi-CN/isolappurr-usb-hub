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

export const DEMO_RESET_EVENT = "isolapurr-demo-reset";
export const DEMO_OWNER = 4242;
export const DEMO_ENTER_QUERY = "?demo=true";
export const DEMO_EXIT_QUERY = "?demo=false";

export type DemoStoredDevice = StoredDevice & {
  demoTransport?: "http" | "local_usb";
};

export type DemoDeviceRecord = {
  stored: DemoStoredDevice;
  discovery: DiscoveredDevice;
  info: DeviceInfoResponse;
  ports: PortsResponse;
  wifi: WifiConfigResponse;
  power: PowerConfigResponse;
  pdDiagnostics: PdDiagnosticsResponse;
  idleBias: IdleBiasResponse;
};

export type DemoWorld = {
  devices: DemoDeviceRecord[];
  discoveryDevices: DiscoveredDevice[];
  discovery: DiscoverySnapshot;
  theme: ThemeId;
  nextManualId: number;
  nextManualIpOctet: number;
};

export type DemoWorldSummary = {
  savedDeviceCount: number;
  discoveryDeviceCount: number;
};

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
      runtime: {
        output_enabled: true,
        discharge_enabled: false,
      },
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
        current: {
          pps3_limit_ma: 5000,
          pd_pps_5a: false,
          type_c_broadcast_ma: 500,
          scp_limit_ma: 5000,
          fcp_afc_sfcp_limit_ma: 3250,
        },
        fast_charge: {
          qc20_20v_enabled: true,
          qc30_20v_enabled: true,
          pe20_20v_enabled: true,
          non_pd_12v_enabled: true,
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
        current: {
          pps3_limit_ma: 5000,
          pd_pps_5a: false,
          type_c_broadcast_ma: 500,
          scp_limit_ma: 5000,
          fcp_afc_sfcp_limit_ma: 3250,
        },
        fast_charge: {
          qc20_20v_enabled: true,
          qc30_20v_enabled: true,
          pe20_20v_enabled: true,
          non_pd_12v_enabled: true,
        },
      },
      sw2303_request: { mv: 9000, ma: 2000 },
      sw2303_vbus_mv: 9010,
      sw2303_last_valid_request: { mv: 9000, ma: 2000 },
      active_protocol: "pd",
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
        discharge_enabled: false,
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

export function buildDefaultDemoPowerConfig(
  record: Pick<DemoDeviceRecord, "stored" | "info">,
): PowerConfigResponse {
  return buildDemoDevice({
    id: record.stored.id,
    name: record.stored.name,
    baseUrl: record.stored.baseUrl,
    fqdn: record.info.device.fqdn,
    ipv4: record.info.device.wifi.ipv4 ?? "192.168.31.42",
    firmwareVersion: record.info.device.firmware.version,
    localUsb: record.stored.demoTransport === "local_usb",
  }).power;
}

export function createCanonicalDemoWorld(): DemoWorld {
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

export function cloneWorld(world: DemoWorld): DemoWorld {
  return JSON.parse(JSON.stringify(world)) as DemoWorld;
}

export function readDemoEnabled(): boolean {
  if (!canUseSessionStorage()) {
    return false;
  }
  return window.sessionStorage.getItem(DEMO_FLAG_KEY) === "true";
}

export function writeDemoEnabled(enabled: boolean): void {
  if (!canUseSessionStorage()) {
    return;
  }
  if (enabled) {
    window.sessionStorage.setItem(DEMO_FLAG_KEY, "true");
    return;
  }
  window.sessionStorage.removeItem(DEMO_FLAG_KEY);
}

export function readDemoWorld(): DemoWorld {
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

export function writeDemoWorld(world: DemoWorld): void {
  if (!canUseSessionStorage()) {
    return;
  }
  window.sessionStorage.setItem(DEMO_WORLD_KEY, JSON.stringify(world));
}

export function clearDemoWorld(): void {
  if (!canUseSessionStorage()) {
    return;
  }
  window.sessionStorage.removeItem(DEMO_WORLD_KEY);
}

export function resetDemoModeSession(): void {
  writeDemoEnabled(true);
  writeDemoWorld(createCanonicalDemoWorld());
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEMO_RESET_EVENT));
  }
}

export function readDemoWorldSummary(): DemoWorldSummary {
  const world = readDemoWorld();
  return {
    savedDeviceCount: world.devices.length,
    discoveryDeviceCount: world.discoveryDevices.length,
  };
}

export function demoStoredDevices(world: DemoWorld): StoredDevice[] {
  return world.devices.map((device) => device.stored);
}

export function findByDeviceId(
  world: DemoWorld,
  deviceId: string,
): DemoDeviceRecord | undefined {
  return world.devices.find((device) => device.stored.id === deviceId);
}

export function findByBaseUrl(
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

export function upsertDemoDevice(
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

export function removeDemoDevice(
  world: DemoWorld,
  deviceId: string,
): DemoWorld {
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

export function makeManualDemoDevice(
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
