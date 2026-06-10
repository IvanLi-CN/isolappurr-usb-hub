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
  | { kind: "preflight_blocked"; message: string }
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

export type PowerConfigResponse = {
  hardware: "sw2303" | string;
  persisted: boolean;
  tps_mode: "auto_follow" | "manual";
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
  };
  manual: {
    voltage_mv: number;
    current_limit_ma: number;
    usb_c_path_mode: "default" | "disconnect" | "force";
    path_policy?: string;
  };
  lock: { owner: number; expires_at_ms: number } | null;
};

export type PowerConfigInput = {
  hardware: "sw2303";
  tps_mode: "auto_follow" | "manual";
  capability: PowerConfigResponse["capability"];
  manual: PowerConfigResponse["manual"];
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

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Result<T>> {
  const url = new URL(path, baseUrl).toString();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);

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
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        error: { kind: "offline", message: "request timed out" },
      };
    }
    const kind = pnaEnabled ? "preflight_blocked" : "offline";
    return {
      ok: false,
      error: {
        kind,
        message:
          kind === "offline"
            ? "device unreachable"
            : "CORS/PNA preflight blocked",
      },
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
  return fetchJson<PowerConfigResponse>(baseUrl, "/api/v1/power/config", {
    method: "GET",
  });
}

export async function setPowerConfig(
  baseUrl: string,
  config: PowerConfigInput,
  owner: number,
): Promise<Result<PowerConfigResponse>> {
  return fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config?owner=${owner}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    },
  );
}

export async function restorePowerDefaults(
  baseUrl: string,
  owner: number,
): Promise<Result<PowerConfigResponse>> {
  return fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config/defaults?owner=${owner}`,
    { method: "POST" },
  );
}

export async function setPowerLock(
  baseUrl: string,
  owner: number,
  acquire: boolean,
): Promise<Result<PowerConfigResponse>> {
  return fetchJson<PowerConfigResponse>(
    baseUrl,
    `/api/v1/power/config/${acquire ? "lock" : "release"}?owner=${owner}`,
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
