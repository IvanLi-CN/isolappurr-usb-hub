import type { Port, PortId, PortsResponse, UsbCDownstreamRoute } from "./ports";

export type DeviceInfoResponse = {
  device: {
    device_id: string;
    hostname: string;
    fqdn: string;
    mac: string;
    variant: string;
    firmware: { name: string; version: string };
    uptime_ms: number;
    wifi: {
      state: "idle" | "connecting" | "connected" | "error";
      ipv4: string | null;
      is_static: boolean;
    };
  };
};

export type DeviceApiError =
  | { kind: "offline"; message: string }
  | {
      kind: "name_resolution";
      message: string;
      actionable: "Name/Reachability";
    }
  | {
      kind: "browser_blocked";
      message: string;
      actionable: "Browser blocked";
    }
  | { kind: "busy"; message: string; retryable: true }
  | {
      kind: "api_error";
      status: number;
      code: string;
      message: string;
      retryable: boolean;
    }
  | { kind: "invalid_response"; message: string };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DeviceApiError };

export type WifiConfigResponse = {
  configured?: boolean;
  storage: "eeprom" | string;
  address: string;
  ssid?: string;
  psk_configured?: boolean;
  state?: DeviceInfoResponse["device"]["wifi"]["state"];
  ipv4?: string | null;
  is_static?: boolean;
};

export type WifiConfigInput = {
  ssid: string;
  psk: string;
};

export type WifiMutationResponse = {
  accepted: true;
  reboot_required: boolean;
};

export type SettingsResetScope = "wifi" | "other";

export type SettingsResetResponse = {
  accepted: true;
  scope: SettingsResetScope;
  reboot_required?: boolean;
  wifi_preserved?: boolean;
};

export type RebootResponse = {
  accepted: true;
};

const DEFAULT_HTTP_TIMEOUT_MS = 4000;
const MDNS_HTTP_TIMEOUT_MS = 6500;

export type PowerConfigResponse = {
  hardware: "sw2303" | string;
  persisted: boolean;
  tps_mode: "auto_follow" | "manual";
  light_load_mode: "pfm" | "fpwm";
  sw2303_line_compensation: "off" | "0mohm" | "50mohm" | "100mohm" | "150mohm";
  runtime?: {
    output_enabled: boolean;
    discharge_enabled: boolean;
  };
  capability: {
    profile: "full" | string;
    power_watts: number;
    protocols: {
      pd: boolean;
      qc20: boolean;
      qc30: boolean;
      fcp: boolean;
      afc: boolean;
      scp: boolean;
      pe20: boolean;
      bc12: boolean;
      sfcp: boolean;
    };
    pd: {
      pps: boolean;
      fixed_voltages_mv: number[];
    };
    current: {
      pps3_limit_ma: number;
      pd_pps_5a: boolean;
      type_c_broadcast_ma: number;
      scp_limit_ma: number;
      fcp_afc_sfcp_limit_ma: number;
    };
    fast_charge: {
      qc20_20v_enabled: boolean;
      qc30_20v_enabled: boolean;
      pe20_20v_enabled: boolean;
      non_pd_12v_enabled: boolean;
    };
  };
  manual: {
    voltage_mv: number;
    current_limit_ma: number;
    usb_c_path_mode: "default" | "disconnect" | "force";
    tps_cdc_rise_mv: 0 | 100 | 200 | 300 | 400 | 500 | 600 | 700;
    path_policy?: string;
  };
  lock: { owner: number; expires_at_ms: number } | null;
};

export type PowerConfigManualInput = {
  voltage_mv: number;
  current_limit_ma: number;
  usb_c_path_mode: "default" | "disconnect" | "force";
  tps_cdc_rise_mv: 0 | 100 | 200 | 300 | 400 | 500 | 600 | 700;
};

export type PowerConfigInput = {
  hardware: "sw2303";
  tps_mode: "auto_follow" | "manual";
  light_load_mode: "pfm" | "fpwm";
  sw2303_line_compensation: "off" | "0mohm" | "50mohm" | "100mohm" | "150mohm";
  capability: PowerConfigResponse["capability"];
  manual: PowerConfigManualInput;
};

function normalizePowerConfigResponse(
  value: PowerConfigResponse,
): PowerConfigResponse {
  return {
    ...value,
    light_load_mode: value.light_load_mode === "fpwm" ? "fpwm" : "pfm",
    sw2303_line_compensation:
      value.sw2303_line_compensation === "off" ||
      value.sw2303_line_compensation === "0mohm" ||
      value.sw2303_line_compensation === "100mohm" ||
      value.sw2303_line_compensation === "150mohm"
        ? value.sw2303_line_compensation
        : "50mohm",
    capability: {
      ...value.capability,
      current: {
        pps3_limit_ma: value.capability.current?.pps3_limit_ma ?? 5000,
        pd_pps_5a: value.capability.current?.pd_pps_5a ?? false,
        type_c_broadcast_ma:
          value.capability.current?.type_c_broadcast_ma ?? 500,
        scp_limit_ma: value.capability.current?.scp_limit_ma ?? 5000,
        fcp_afc_sfcp_limit_ma:
          value.capability.current?.fcp_afc_sfcp_limit_ma ?? 3250,
      },
      fast_charge: {
        qc20_20v_enabled:
          value.capability.fast_charge?.qc20_20v_enabled ?? true,
        qc30_20v_enabled:
          value.capability.fast_charge?.qc30_20v_enabled ?? true,
        pe20_20v_enabled:
          value.capability.fast_charge?.pe20_20v_enabled ?? true,
        non_pd_12v_enabled:
          value.capability.fast_charge?.non_pd_12v_enabled ?? true,
      },
    },
    runtime: {
      output_enabled: value.runtime?.output_enabled ?? true,
      discharge_enabled: value.runtime?.discharge_enabled ?? false,
    },
    manual: {
      ...value.manual,
      tps_cdc_rise_mv:
        value.manual?.tps_cdc_rise_mv === 100 ||
        value.manual?.tps_cdc_rise_mv === 200 ||
        value.manual?.tps_cdc_rise_mv === 300 ||
        value.manual?.tps_cdc_rise_mv === 400 ||
        value.manual?.tps_cdc_rise_mv === 500 ||
        value.manual?.tps_cdc_rise_mv === 600 ||
        value.manual?.tps_cdc_rise_mv === 700
          ? value.manual.tps_cdc_rise_mv
          : 0,
    },
  };
}

export type PdDiagnosticsResponse = {
  usb_c_power_enabled: boolean;
  sw2303_i2c_allowed: boolean;
  sw2303_profile_applied: boolean;
  sw2303_stable_reads: number;
  sw2303_error_latched: boolean;
  tps_error_latched: boolean;
  sw2303_readback_config: {
    available: boolean;
    matches_config: boolean;
    power_watts: number | null;
    protocols: {
      pd: boolean | null;
      qc20: boolean | null;
      qc30: boolean | null;
      fcp: boolean | null;
      afc: boolean | null;
      scp: boolean | null;
      pe20: boolean | null;
      bc12: boolean | null;
      sfcp: boolean | null;
    };
    pd: {
      pps: boolean | null;
      fixed_voltages_mv: number[];
    };
    current: {
      pps3_limit_ma: number | null;
      pd_pps_5a: boolean | null;
      type_c_broadcast_ma: number | null;
      scp_limit_ma: number | null;
      fcp_afc_sfcp_limit_ma: number | null;
    };
    fast_charge: {
      qc20_20v_enabled: boolean | null;
      qc30_20v_enabled: boolean | null;
      pe20_20v_enabled: boolean | null;
      non_pd_12v_enabled: boolean | null;
    };
  };
  sw2303_request: { mv: number | null; ma: number | null };
  sw2303_vbus_mv: number | null;
  sw2303_last_valid_request: { mv: number | null; ma: number | null };
  active_protocol:
    | "pd"
    | "pps"
    | "qc20"
    | "qc30"
    | "fcp"
    | "afc"
    | "scp"
    | "pe20"
    | "bc12"
    | "sfcp"
    | null;
  display: {
    mode: {
      kind: "pd" | "pps" | "dc" | "off";
      label: string;
    };
    measurements_visible: boolean;
    badge: {
      kind: "voltage" | "focus" | "on" | "off" | "unknown";
      label: string;
    };
  };
  usb_c_actual: {
    status: "ok" | "not_inserted" | "error" | "overrange" | string;
    voltage_mv: number | null;
    current_ma: number | null;
    power_mw: number | null;
    sample_uptime_ms: number;
  };
  tps_setpoint: {
    output_enabled: boolean | null;
    discharge_enabled?: boolean | null;
    mv: number | null;
    iout_limit_ma: number | null;
  };
  tps_iout_limit_readback: {
    enabled: boolean | null;
    ma: number | null;
  };
  thermal: {
    sensors: {
      mcu: {
        temperature_deci_c: number | null;
        status: "ok" | "stale" | "error" | string;
      };
      tmp112: {
        temperature_deci_c: number | null;
        status: "ok" | "stale" | "error" | string;
      };
    };
    hottest_temperature_deci_c: number | null;
    state:
      | "normal"
      | "derating"
      | "shutdown"
      | "rearm_required"
      | "sensor_fault"
      | string;
    reason:
      | "none"
      | "mcu_hot"
      | "tmp112_hot"
      | "both_hot"
      | "mcu_critical"
      | "tmp112_critical"
      | "both_critical"
      | "mcu_sensor_fault"
      | "tmp112_sensor_fault"
      | "both_sensor_fault"
      | string;
    effective_power_watts: number;
    sample_uptime_ms: number;
  };
  runtime_recovery_count: number;
  sample_uptime_ms: number;
};

export type IdleBiasDataset = {
  status: "valid" | "missing" | string;
  min_voltage_mv: number;
  max_voltage_mv: number;
  step_mv: number;
  point_count: number;
  offsets_ma: number[] | null;
};

export type IdleBiasError = {
  code: string;
  message: string;
};

export type IdleBiasRun = {
  state: "idle" | "running" | "failed" | string;
  completed_points: number;
  point_count: number;
  target_voltage_mv: number | null;
  error: IdleBiasError | null;
};

export type IdleBiasResponse = {
  correction_enabled: boolean;
  dataset: IdleBiasDataset;
  current_applied_offset_ma: number | null;
  run: IdleBiasRun;
};

type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseErrorEnvelope(value: unknown): ErrorEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  const error = value.error;
  if (!isRecord(error)) {
    return null;
  }
  if (typeof error.code !== "string") {
    return null;
  }
  if (typeof error.message !== "string") {
    return null;
  }
  if (typeof error.retryable !== "boolean") {
    return null;
  }
  return value as ErrorEnvelope;
}

function shouldUsePna(baseUrl: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (!window.isSecureContext) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
}

function serializePowerConfigInput(config: PowerConfigInput): string {
  return JSON.stringify({
    hardware: config.hardware,
    tps_mode: config.tps_mode,
    light_load_mode: config.light_load_mode,
    sw2303_line_compensation: config.sw2303_line_compensation,
    capability: {
      profile: config.capability.profile,
      power_watts: config.capability.power_watts,
      protocols: config.capability.protocols,
      pd: config.capability.pd,
      current: config.capability.current,
      fast_charge: config.capability.fast_charge,
    },
    manual: {
      voltage_mv: config.manual.voltage_mv,
      current_limit_ma: config.manual.current_limit_ma,
      usb_c_path_mode: config.manual.usb_c_path_mode,
      tps_cdc_rise_mv: config.manual.tps_cdc_rise_mv,
    },
  } satisfies PowerConfigInput);
}

function requestTimeoutMs(baseUrl: string): number {
  try {
    const hostname = new URL(baseUrl).hostname;
    if (hostname.endsWith(".local")) {
      return MDNS_HTTP_TIMEOUT_MS;
    }
  } catch {
    // Fall back to the default timeout when the base URL is malformed.
  }
  return DEFAULT_HTTP_TIMEOUT_MS;
}

function classifyFetchFailure(
  baseUrl: string,
  pnaEnabled: boolean,
  err: unknown,
): DeviceApiError {
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    hostname = "";
  }

  if (err instanceof DOMException && err.name === "AbortError") {
    if (hostname.endsWith(".local")) {
      return {
        kind: "name_resolution",
        actionable: "Name/Reachability",
        message:
          "The mDNS hostname did not resolve quickly enough. Try the verified IPv4 address or re-check local network name resolution.",
      };
    }
    return {
      kind: "offline",
      message: "Device did not respond before the request timed out.",
    };
  }

  const message = err instanceof Error ? err.message : String(err ?? "");
  const normalized = message.toLowerCase();
  const isLocalHostname = hostname.endsWith(".local");
  const explicitBrowserBlockedSignals = [
    "private network access",
    "cors",
    "access-control",
    "blocked by client",
  ];
  const explicitNameReachabilitySignals = [
    "err_name_not_resolved",
    "name not resolved",
    "dns",
  ];
  const genericFetchFailureSignals = [
    "failed to fetch",
    "networkerror",
    "network error",
    "load failed",
    "network request failed",
    "fetch failed",
  ];

  if (
    explicitBrowserBlockedSignals.some((signal) => normalized.includes(signal))
  ) {
    return {
      kind: "browser_blocked",
      actionable: "Browser blocked",
      message:
        "Browser blocked private-network access. Allow the request or retry from a browser context that can access LAN devices.",
    };
  }

  if (
    explicitNameReachabilitySignals.some((signal) =>
      normalized.includes(signal),
    )
  ) {
    return {
      kind: "name_resolution",
      actionable: "Name/Reachability",
      message:
        "Hostname could not be reached. Try the verified IPv4 address or re-check local network name resolution.",
    };
  }

  if (
    isLocalHostname &&
    genericFetchFailureSignals.some((signal) => normalized.includes(signal))
  ) {
    return {
      kind: "name_resolution",
      actionable: "Name/Reachability",
      message:
        "Hostname could not be reached. If you are using the HTTPS web app, browser private-network policy may also be involved. Try the verified IPv4 address first.",
    };
  }

  if (
    pnaEnabled &&
    genericFetchFailureSignals.some((signal) => normalized.includes(signal))
  ) {
    return {
      kind: "browser_blocked",
      actionable: "Browser blocked",
      message:
        "Browser blocked private-network access. Allow the request or retry from a browser context that can access LAN devices.",
    };
  }

  return {
    kind: "offline",
    message: "Device is unreachable on the current network path.",
  };
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Result<T>> {
  const url = new URL(path, baseUrl).toString();

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    requestTimeoutMs(baseUrl),
  );

  const pnaEnabled = shouldUsePna(baseUrl);
  const requestInit = {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: controller.signal,
    ...(pnaEnabled ? ({ targetAddressSpace: "private" } as const) : {}),
  };

  try {
    const res = await fetch(url, requestInit as RequestInit);
    const text = await res.text();

    const json: unknown = text.length === 0 ? null : JSON.parse(text);

    if (res.ok) {
      return { ok: true, value: json as T };
    }

    const envelope = parseErrorEnvelope(json);
    if (envelope) {
      if (res.status === 409 && envelope.error.code === "busy") {
        return {
          ok: false,
          error: {
            kind: "busy",
            message: envelope.error.message,
            retryable: true,
          },
        };
      }

      return {
        ok: false,
        error: {
          kind: "api_error",
          status: res.status,
          code: envelope.error.code,
          message: envelope.error.message,
          retryable: envelope.error.retryable,
        },
      };
    }

    return {
      ok: false,
      error: {
        kind: "api_error",
        status: res.status,
        code: "unknown",
        message: text || res.statusText,
        retryable: false,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: classifyFetchFailure(baseUrl, pnaEnabled, err),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getPorts(
  baseUrl: string,
): Promise<Result<PortsResponse>> {
  return fetchJson<PortsResponse>(baseUrl, "/api/v1/ports", { method: "GET" });
}

export async function getPort(
  baseUrl: string,
  portId: PortId,
): Promise<Result<Port>> {
  return fetchJson<Port>(baseUrl, `/api/v1/ports/${portId}`, { method: "GET" });
}

export async function replugPort(
  baseUrl: string,
  portId: PortId,
): Promise<Result<{ accepted: true }>> {
  return fetchJson<{ accepted: true }>(
    baseUrl,
    `/api/v1/ports/${portId}/actions/replug`,
    {
      method: "POST",
    },
  );
}

export async function setPortPower(
  baseUrl: string,
  portId: PortId,
  enabled: boolean,
): Promise<Result<{ accepted: true; power_enabled: boolean }>> {
  const query = enabled ? "enabled=1" : "enabled=0";
  return fetchJson<{ accepted: true; power_enabled: boolean }>(
    baseUrl,
    `/api/v1/ports/${portId}/power?${query}`,
    { method: "POST" },
  );
}

export async function setUsbCDownstreamRoute(
  baseUrl: string,
  route: UsbCDownstreamRoute,
): Promise<
  Result<{
    accepted: true;
    usb_c_downstream_route: UsbCDownstreamRoute;
    persisted: boolean;
  }>
> {
  return fetchJson<{
    accepted: true;
    usb_c_downstream_route: UsbCDownstreamRoute;
    persisted: boolean;
  }>(baseUrl, `/api/v1/hub/usb-c-downstream-route?route=${route}`, {
    method: "POST",
  });
}

export async function getPowerConfig(
  baseUrl: string,
): Promise<Result<PowerConfigResponse>> {
  const res = await fetchJson<PowerConfigResponse>(
    baseUrl,
    "/api/v1/power/config",
    {
      method: "GET",
    },
  );
  return res.ok
    ? { ok: true, value: normalizePowerConfigResponse(res.value) }
    : res;
}

export async function getPdDiagnostics(
  baseUrl: string,
): Promise<Result<PdDiagnosticsResponse>> {
  return fetchJson<PdDiagnosticsResponse>(baseUrl, "/api/v1/pd-diagnostics", {
    method: "GET",
  });
}

export async function setPowerConfig(
  baseUrl: string,
  config: PowerConfigInput,
  owner: number,
): Promise<Result<PowerConfigResponse>> {
  const res = await fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config?owner=${owner}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serializePowerConfigInput(config),
    },
  );
  return res.ok
    ? { ok: true, value: normalizePowerConfigResponse(res.value) }
    : res;
}

export async function restorePowerDefaults(
  baseUrl: string,
  owner: number,
): Promise<Result<PowerConfigResponse>> {
  const res = await fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config/defaults?owner=${owner}`,
    { method: "POST" },
  );
  return res.ok
    ? { ok: true, value: normalizePowerConfigResponse(res.value) }
    : res;
}

export async function setPowerLock(
  baseUrl: string,
  owner: number,
  acquire: boolean,
): Promise<Result<PowerConfigResponse>> {
  const res = await fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config/${acquire ? "lock" : "release"}?owner=${owner}`,
    { method: "POST" },
  );
  return res.ok
    ? { ok: true, value: normalizePowerConfigResponse(res.value) }
    : res;
}

export async function setPowerRuntime(
  baseUrl: string,
  owner: number,
  action: "output" | "discharge",
  enabled: boolean,
): Promise<Result<PowerConfigResponse>> {
  const res = await fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/runtime?owner=${owner}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, enabled }),
    },
  );
  return res.ok
    ? { ok: true, value: normalizePowerConfigResponse(res.value) }
    : res;
}

export async function getIdleBias(
  baseUrl: string,
): Promise<Result<IdleBiasResponse>> {
  return fetchJson<IdleBiasResponse>(baseUrl, "/api/v1/power/idle-bias", {
    method: "GET",
  });
}

export async function setIdleBiasCorrection(
  baseUrl: string,
  correctionEnabled: boolean,
  owner: number,
): Promise<Result<IdleBiasResponse>> {
  return fetchJson<IdleBiasResponse>(
    baseUrl,
    `/api/v1/power/idle-bias?owner=${owner}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correction_enabled: correctionEnabled }),
    },
  );
}

export async function runIdleBiasCalibration(
  baseUrl: string,
  owner: number,
): Promise<Result<IdleBiasResponse>> {
  return fetchJson<IdleBiasResponse>(
    baseUrl,
    `/api/v1/power/idle-bias/run?owner=${owner}`,
    { method: "POST" },
  );
}

export async function clearIdleBiasCalibration(
  baseUrl: string,
  owner: number,
): Promise<Result<IdleBiasResponse>> {
  return fetchJson<IdleBiasResponse>(
    baseUrl,
    `/api/v1/power/idle-bias/clear?owner=${owner}`,
    { method: "POST" },
  );
}

export async function getDeviceInfo(
  baseUrl: string,
): Promise<Result<DeviceInfoResponse>> {
  return fetchJson<DeviceInfoResponse>(baseUrl, "/api/v1/info", {
    method: "GET",
  });
}

export async function getWifiConfig(
  baseUrl: string,
): Promise<Result<WifiConfigResponse>> {
  return fetchJson<WifiConfigResponse>(baseUrl, "/api/v1/wifi", {
    method: "GET",
  });
}

export async function setWifiConfig(
  baseUrl: string,
  input: WifiConfigInput,
): Promise<Result<WifiMutationResponse>> {
  return fetchJson<WifiMutationResponse>(baseUrl, "/api/v1/wifi/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function clearWifiConfig(
  baseUrl: string,
): Promise<Result<WifiMutationResponse>> {
  return fetchJson<WifiMutationResponse>(baseUrl, "/api/v1/wifi/clear", {
    method: "POST",
  });
}

export async function resetSettings(
  baseUrl: string,
  scope: SettingsResetScope,
  owner?: number,
): Promise<Result<SettingsResetResponse>> {
  const ownerQuery = owner === undefined ? "" : `&owner=${owner}`;
  return fetchJson<SettingsResetResponse>(
    baseUrl,
    `/api/v1/settings/reset?scope=${scope}${ownerQuery}`,
    { method: "POST" },
  );
}

export async function rebootDevice(
  baseUrl: string,
): Promise<Result<RebootResponse>> {
  return fetchJson<RebootResponse>(baseUrl, "/api/v1/reboot", {
    method: "POST",
  });
}
