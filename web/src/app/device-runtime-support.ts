import { type DesktopAgent, isDemoDesktopAgent } from "../domain/desktopAgent";
import type {
  DeviceApiError,
  DeviceInfoResponse,
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigResponse,
  RebootResponse,
  Result,
  SettingsResetResponse,
  SettingsResetScope,
  WifiConfigInput,
  WifiConfigResponse,
  WifiMutationResponse,
} from "../domain/deviceApi";
import type { StoredDevice } from "../domain/devices";
import {
  devdLocalUsbDeviceIdFromBaseUrl,
  type JsonlRequest,
  LocalUsbAgentHttpError,
  nextJsonlRequestId,
} from "../domain/hardwareConsole";
import type {
  HubState,
  Port,
  PortId,
  PortsResponse,
  UsbCDownstreamRoute,
} from "../domain/ports";
import type { CrossTabRuntimeLeaseState } from "./cross-tab-runtime";

export type ConnectionState = "online" | "offline" | "unknown";
export type DeviceTransport = "http" | "web_serial" | "local_usb";

export type ChannelRuntime = {
  lastOkAt: number | null;
  lastError: DeviceApiError | null;
};

export type DeviceRuntime = {
  lastOkAt: number | null;
  lastError: DeviceApiError | null;
  transport: DeviceTransport | null;
  channels: Record<DeviceTransport, ChannelRuntime>;
  hub: HubState | null;
  ports: Record<PortId, Port> | null;
  pending: Record<PortId, boolean>;
  powerConfig: PowerConfigResponse | null;
  idleBias: IdleBiasResponse | null;
  pdDiagnostics: PdDiagnosticsResponse | null;
};

export type DeviceRuntimeContextValue = {
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
  coordination: CrossTabRuntimeLeaseState;
  canControlHardware: boolean;
  connectionState: (deviceId: string) => ConnectionState;
  lastOkAt: (deviceId: string) => number | null;
  lastErrorLabel: (deviceId: string) => string | null;
  transport: (deviceId: string) => DeviceTransport | null;
  wifiManagementTransport: (deviceId: string) => DeviceTransport | null;
  channelState: (
    deviceId: string,
    transport: DeviceTransport,
  ) => ConnectionState;
  hub: (deviceId: string) => HubState | null;
  port: (deviceId: string, portId: PortId) => Port | null;
  pending: (deviceId: string, portId: PortId) => boolean;
  powerLockOwner: (deviceId: string) => number;
  requestControlTakeover: () => void;
  refreshDevice: (deviceId: string) => Promise<void>;
  deviceInfo: (deviceId: string) => Promise<Result<DeviceInfoResponse>>;
  wifiConfig: (deviceId: string) => Promise<Result<WifiConfigResponse>>;
  saveWifiConfig: (
    deviceId: string,
    input: WifiConfigInput,
  ) => Promise<Result<WifiMutationResponse>>;
  clearWifiConfig: (deviceId: string) => Promise<Result<WifiMutationResponse>>;
  resetSettings: (
    deviceId: string,
    scope: SettingsResetScope,
  ) => Promise<Result<SettingsResetResponse>>;
  rebootDevice: (deviceId: string) => Promise<Result<RebootResponse>>;
  pdDiagnostics: (deviceId: string) => Promise<Result<PdDiagnosticsResponse>>;
  powerConfig: (deviceId: string) => Promise<Result<PowerConfigResponse>>;
  idleBias: (deviceId: string) => Promise<Result<IdleBiasResponse>>;
  savePowerConfig: (
    deviceId: string,
    input: PowerConfigInput,
    owner: number,
  ) => Promise<Result<PowerConfigResponse>>;
  restorePowerDefaults: (
    deviceId: string,
    owner: number,
  ) => Promise<Result<PowerConfigResponse>>;
  setPowerLock: (
    deviceId: string,
    owner: number,
    acquire: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setPowerRuntime: (
    deviceId: string,
    owner: number,
    action: "output" | "discharge",
    enabled: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setIdleBiasCorrection: (
    deviceId: string,
    correctionEnabled: boolean,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  runIdleBiasCalibration: (
    deviceId: string,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  clearIdleBiasCalibration: (
    deviceId: string,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  setPower: (
    deviceId: string,
    portId: PortId,
    enabled: boolean,
  ) => Promise<void>;
  replug: (deviceId: string, portId: PortId) => Promise<void>;
  setUsbCDownstreamRoute: (
    deviceId: string,
    route: UsbCDownstreamRoute,
  ) => Promise<void>;
};

const TRANSPORTS: DeviceTransport[] = ["http", "web_serial", "local_usb"];
const JSONL_POWER_IDLE_BIAS_RUN_TIMEOUT_MS = 178_000;
const JSONL_POWER_CONFIG_TIMEOUT_MS = 20_000;
const POWER_LOCK_OWNER_STORAGE_KEY = "isolapurr.runtime.power-lock-owners.v1";
const POWER_LOCK_RESUME_WINDOW_MS = 15_000;

type PowerLockOwnerRecord = {
  ownerId: number;
  resumeUntilMs: number;
  updatedAtMs: number;
};

export function httpBaseUrlForDevice(device: StoredDevice): string {
  return device.transports?.httpBaseUrl ?? device.baseUrl;
}

export function verifiedWifiHttpBaseUrl(
  info: DeviceInfoResponse,
  deviceId: string,
): string | null {
  const infoDeviceId = info.device.device_id?.trim().toLowerCase();
  const wifiIpv4 = info.device.wifi?.ipv4?.trim();
  if (!infoDeviceId || infoDeviceId !== deviceId || !wifiIpv4) {
    return null;
  }
  return `http://${wifiIpv4}`;
}

export function localUsbPortPathForDevice(device: StoredDevice): string | null {
  const portPath = device.transports?.localUsbPortPath?.trim();
  return portPath ? portPath : null;
}

export function localUsbDeviceIdForDevice(device: StoredDevice): string | null {
  return devdLocalUsbDeviceIdFromBaseUrl(device.baseUrl);
}

export function resolveLocalUsbTarget({
  deviceId,
  devices,
  cachedPortPath,
  linkedPortPath,
}: {
  deviceId: string;
  devices: StoredDevice[];
  cachedPortPath: string | null | undefined;
  linkedPortPath: string | null;
}):
  | { kind: "port_path"; portPath: string }
  | { kind: "devd_device"; deviceId: string }
  | null {
  if (cachedPortPath) {
    return { kind: "port_path", portPath: cachedPortPath };
  }
  if (linkedPortPath) {
    return { kind: "port_path", portPath: linkedPortPath };
  }
  const stored = devices.find((device) => device.id === deviceId);
  const devdDeviceId = stored ? localUsbDeviceIdForDevice(stored) : null;
  if (devdDeviceId) {
    return { kind: "devd_device", deviceId: devdDeviceId };
  }
  const storedPortPath = stored ? localUsbPortPathForDevice(stored) : null;
  if (storedPortPath) {
    return { kind: "port_path", portPath: storedPortPath };
  }
  return null;
}

export function shortApiError(err: DeviceApiError): string {
  if (err.kind === "offline") {
    return "Offline: device unreachable";
  }
  if (err.kind === "name_resolution") {
    return "Name/Reachability: use verified IPv4";
  }
  if (err.kind === "browser_blocked") {
    return "Browser blocked: private-network access";
  }
  if (err.kind === "invalid_response") {
    return "Invalid response";
  }
  if (err.kind === "busy") {
    return "Busy";
  }
  return `API error: ${err.code}`;
}

function createPowerLockOwner(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

const powerLockOwners = new Map<string, number>();

function readPowerLockOwnerRecords(): Record<string, PowerLockOwnerRecord> {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return {};
  }
  const raw = window.localStorage.getItem(POWER_LOCK_OWNER_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      Partial<PowerLockOwnerRecord>
    >;
    const next: Record<string, PowerLockOwnerRecord> = {};
    for (const [deviceKey, record] of Object.entries(parsed)) {
      if (
        typeof record.ownerId !== "number" ||
        !Number.isInteger(record.ownerId) ||
        record.ownerId <= 0 ||
        typeof record.resumeUntilMs !== "number" ||
        typeof record.updatedAtMs !== "number"
      ) {
        continue;
      }
      next[deviceKey] = {
        ownerId: record.ownerId,
        resumeUntilMs: record.resumeUntilMs,
        updatedAtMs: record.updatedAtMs,
      };
    }
    return next;
  } catch {
    return {};
  }
}

function writePowerLockOwnerRecords(
  records: Record<string, PowerLockOwnerRecord>,
): void {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return;
  }
  window.localStorage.setItem(
    POWER_LOCK_OWNER_STORAGE_KEY,
    JSON.stringify(records),
  );
}

function updatePowerLockOwnerRecord(
  deviceKey: string,
  update: (current: PowerLockOwnerRecord | null) => PowerLockOwnerRecord | null,
): PowerLockOwnerRecord | null {
  const records = readPowerLockOwnerRecords();
  const current = records[deviceKey] ?? null;
  const next = update(current);
  if (next) {
    records[deviceKey] = next;
  } else {
    delete records[deviceKey];
  }
  writePowerLockOwnerRecords(records);
  return next;
}

export function getStablePowerLockOwner(deviceKey: string): number {
  const existing = powerLockOwners.get(deviceKey);
  if (existing) {
    return existing;
  }
  const stored = readPowerLockOwnerRecords()[deviceKey];
  if (stored?.ownerId) {
    powerLockOwners.set(deviceKey, stored.ownerId);
    return stored.ownerId;
  }
  const owner = createPowerLockOwner();
  powerLockOwners.set(deviceKey, owner);
  updatePowerLockOwnerRecord(deviceKey, (current) => ({
    ownerId: owner,
    resumeUntilMs: current?.resumeUntilMs ?? 0,
    updatedAtMs: Date.now(),
  }));
  return owner;
}

export function canResumePowerLock(
  deviceKey: string,
  now = Date.now(),
): boolean {
  const record = readPowerLockOwnerRecords()[deviceKey];
  return Boolean(record && record.resumeUntilMs > now);
}

export function markPowerLockHeld(deviceKey: string, now = Date.now()): void {
  const ownerId = getStablePowerLockOwner(deviceKey);
  updatePowerLockOwnerRecord(deviceKey, () => ({
    ownerId,
    resumeUntilMs: now + POWER_LOCK_RESUME_WINDOW_MS,
    updatedAtMs: now,
  }));
}

export function clearPowerLockResume(deviceKey: string): void {
  const ownerId = getStablePowerLockOwner(deviceKey);
  updatePowerLockOwnerRecord(deviceKey, () => ({
    ownerId,
    resumeUntilMs: 0,
    updatedAtMs: Date.now(),
  }));
}

export function createEmptyChannels(): Record<DeviceTransport, ChannelRuntime> {
  return {
    http: { lastOkAt: null, lastError: null },
    web_serial: { lastOkAt: null, lastError: null },
    local_usb: { lastOkAt: null, lastError: null },
  };
}

export function shouldResetLocalUsbConnectionCache(err: unknown): boolean {
  if (err instanceof LocalUsbAgentHttpError) {
    return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  return !message.includes("serial port is busy");
}

export function shouldReuseLocalUsbAgentForDemoMode(
  agent: DesktopAgent | null | undefined,
  demoEnabled: boolean,
): agent is DesktopAgent {
  if (!agent) {
    return false;
  }
  return isDemoDesktopAgent(agent) === demoEnabled;
}

export function resetLocalUsbRuntimeState(
  runtimeById: Record<string, DeviceRuntime>,
): Record<string, DeviceRuntime> {
  let changed = false;
  const next: Record<string, DeviceRuntime> = {};
  for (const [deviceId, runtime] of Object.entries(runtimeById)) {
    const transport =
      runtime.transport === "local_usb" ? null : runtime.transport;
    const localUsbChannel =
      runtime.channels.local_usb.lastOkAt === null &&
      runtime.channels.local_usb.lastError === null
        ? runtime.channels.local_usb
        : { lastOkAt: null, lastError: null };
    if (
      transport !== runtime.transport ||
      localUsbChannel !== runtime.channels.local_usb
    ) {
      changed = true;
    }
    next[deviceId] = {
      ...runtime,
      transport,
      channels: {
        ...runtime.channels,
        local_usb: localUsbChannel,
      },
    };
  }
  return changed ? next : runtimeById;
}

export function resetLocalUsbRuntimeStateForDevice(
  runtimeById: Record<string, DeviceRuntime>,
  deviceId: string,
): Record<string, DeviceRuntime> {
  const current = runtimeById[deviceId];
  if (!current) {
    return runtimeById;
  }
  const transport =
    current.transport === "local_usb" ? null : current.transport;
  const localUsbChannel =
    current.channels.local_usb.lastOkAt === null &&
    current.channels.local_usb.lastError === null
      ? current.channels.local_usb
      : { lastOkAt: null, lastError: null };
  if (
    transport === current.transport &&
    localUsbChannel === current.channels.local_usb
  ) {
    return runtimeById;
  }
  return {
    ...runtimeById,
    [deviceId]: {
      ...current,
      transport,
      channels: {
        ...current.channels,
        local_usb: localUsbChannel,
      },
    },
  };
}

export function localUsbErrorToDeviceApiError(err: unknown): DeviceApiError {
  if (err instanceof LocalUsbAgentHttpError) {
    if (err.status === 409 && err.code === "busy") {
      return { kind: "busy", message: err.message, retryable: true };
    }
    return {
      kind: "api_error",
      status: err.status,
      code: err.code,
      message: err.message,
      retryable: err.retryable,
    };
  }
  return {
    kind: "offline",
    message: err instanceof Error ? err.message : "Local USB request failed",
  };
}

export function shouldForgetWebSerialTransport(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("web serial transport is not connected") ||
    normalized.includes("web serial transport disconnected") ||
    normalized.includes("serial stream closed") ||
    normalized.includes("the port is closed") ||
    normalized.includes("the device has been lost")
  );
}

export function jsonlTimeoutMsForMethod(
  method: string,
  params?: Record<string, unknown>,
): number | undefined {
  if (
    method === "power.config_set" ||
    method === "power.config_defaults" ||
    method === "power.runtime_set" ||
    method === "power.idle_bias_set" ||
    method === "power.idle_bias_clear"
  ) {
    return JSONL_POWER_CONFIG_TIMEOUT_MS;
  }
  if (method === "power.idle_bias_run") {
    return JSONL_POWER_IDLE_BIAS_RUN_TIMEOUT_MS;
  }
  if (
    method === "wifi.clear" ||
    (method === "settings.reset" && params?.scope === "wifi")
  ) {
    return 8_000;
  }
  return undefined;
}

export async function runQueuedDeviceRequest<T>(
  queues: Record<string, Promise<void>>,
  deviceId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = queues[deviceId] ?? Promise.resolve();
  let releaseQueue: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  queues[deviceId] = queued;
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    releaseQueue();
    if (queues[deviceId] === queued) {
      delete queues[deviceId];
    }
  }
}

export function uniqueTransports(
  candidates: Array<DeviceTransport | null | undefined>,
): DeviceTransport[] {
  const seen = new Set<DeviceTransport>();
  const ordered: DeviceTransport[] = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    if (!TRANSPORTS.includes(candidate)) {
      continue;
    }
    seen.add(candidate);
    ordered.push(candidate);
  }
  return ordered;
}

export function orderedDeviceTransports({
  preferred,
  runtimeTransport,
  channelLastOkAt,
  httpLinked,
  localUsbLinked,
  webSerialLinked,
  preferLocalUsbFirst,
}: {
  preferred: DeviceTransport | null | undefined;
  runtimeTransport: DeviceTransport | null | undefined;
  channelLastOkAt:
    | Partial<Record<DeviceTransport, number | null>>
    | null
    | undefined;
  httpLinked: boolean;
  localUsbLinked: boolean;
  webSerialLinked: boolean;
  preferLocalUsbFirst: boolean;
}): DeviceTransport[] {
  const current = preferred ?? runtimeTransport;
  const active =
    current &&
    channelLastOkAt?.[current] &&
    ((current === "http" && httpLinked) ||
      (current === "local_usb" && localUsbLinked) ||
      (current === "web_serial" && webSerialLinked))
      ? current
      : null;

  return preferLocalUsbFirst
    ? uniqueTransports([
        active,
        localUsbLinked ? "local_usb" : null,
        httpLinked ? "http" : null,
        webSerialLinked ? "web_serial" : null,
      ])
    : uniqueTransports([
        active,
        httpLinked ? "http" : null,
        webSerialLinked ? "web_serial" : null,
        localUsbLinked ? "local_usb" : null,
      ]);
}

export function isLinkedTransportActive({
  transport,
  httpLinked,
  localUsbLinked,
  webSerialLinked,
}: {
  transport: DeviceTransport | null | undefined;
  httpLinked: boolean;
  localUsbLinked: boolean;
  webSerialLinked: boolean;
}): boolean {
  if (!transport) {
    return false;
  }
  if (transport === "http") {
    return httpLinked;
  }
  if (transport === "local_usb") {
    return localUsbLinked;
  }
  return webSerialLinked;
}

export function resolveOrderedDeviceTransports({
  deviceId,
  devices,
  runtime,
  preferred,
  localUsbPortPath,
  hasLocalUsbLink,
  hasWebSerialLink,
  localUsbSuppressed = false,
}: {
  deviceId: string;
  devices: StoredDevice[];
  runtime: DeviceRuntime | null | undefined;
  preferred: DeviceTransport | null | undefined;
  localUsbPortPath: string | null | undefined;
  hasLocalUsbLink: boolean;
  hasWebSerialLink: boolean;
  localUsbSuppressed?: boolean;
}): DeviceTransport[] {
  const stored = devices.find((device) => device.id === deviceId);
  const storedLocalUsbPortPath = stored
    ? localUsbPortPathForDevice(stored)
    : null;
  const httpLinked =
    !!stored?.transports?.httpBaseUrl ||
    (stored ? !localUsbPortPathForDevice(stored) : false);
  const localUsbReady =
    !localUsbSuppressed && (Boolean(localUsbPortPath) || hasLocalUsbLink);
  const localUsbLinked =
    !localUsbSuppressed && (localUsbReady || Boolean(storedLocalUsbPortPath));
  return orderedDeviceTransports({
    preferred,
    runtimeTransport: runtime?.transport ?? null,
    channelLastOkAt: runtime
      ? {
          http: runtime.channels.http.lastOkAt,
          web_serial: runtime.channels.web_serial.lastOkAt,
          local_usb: runtime.channels.local_usb.lastOkAt,
        }
      : null,
    httpLinked,
    localUsbLinked,
    webSerialLinked: hasWebSerialLink,
    preferLocalUsbFirst: localUsbReady,
  });
}

export function resolveActiveDeviceTransport({
  deviceId,
  devices,
  runtime,
  preferred,
  localUsbPortPath,
  hasLocalUsbLink,
  hasWebSerialLink,
  localUsbSuppressed = false,
}: {
  deviceId: string;
  devices: StoredDevice[];
  runtime: DeviceRuntime | null | undefined;
  preferred: DeviceTransport | null | undefined;
  localUsbPortPath: string | null | undefined;
  hasLocalUsbLink: boolean;
  hasWebSerialLink: boolean;
  localUsbSuppressed?: boolean;
}): DeviceTransport | null {
  const stored = devices.find((device) => device.id === deviceId);
  const storedLocalUsbPortPath = stored
    ? localUsbPortPathForDevice(stored)
    : null;
  const httpLinked =
    !!stored?.transports?.httpBaseUrl ||
    (stored ? !localUsbPortPathForDevice(stored) : false);
  const localUsbReady =
    !localUsbSuppressed && (Boolean(localUsbPortPath) || hasLocalUsbLink);
  const localUsbLinked =
    !localUsbSuppressed && (localUsbReady || Boolean(storedLocalUsbPortPath));
  const activeTransport = runtime?.transport ?? null;
  if (
    isLinkedTransportActive({
      transport: activeTransport,
      httpLinked,
      localUsbLinked,
      webSerialLinked: hasWebSerialLink,
    })
  ) {
    return activeTransport;
  }
  const next = orderedDeviceTransports({
    preferred,
    runtimeTransport: activeTransport,
    channelLastOkAt: runtime
      ? {
          http: runtime.channels.http.lastOkAt,
          web_serial: runtime.channels.web_serial.lastOkAt,
          local_usb: runtime.channels.local_usb.lastOkAt,
        }
      : null,
    httpLinked,
    localUsbLinked,
    webSerialLinked: hasWebSerialLink,
    preferLocalUsbFirst: localUsbReady,
  });
  return next[0] ?? null;
}

export type DeviceTransportBadgeState = "primary" | "connected" | "history";

export function resolveTransportBadgeState({
  candidate,
  activeTransport,
  channelOnline,
  linked,
  hasHistory,
}: {
  candidate: DeviceTransport;
  activeTransport: DeviceTransport | null;
  channelOnline: boolean;
  linked: boolean;
  hasHistory: boolean;
}): DeviceTransportBadgeState | null {
  if (!hasHistory && !linked) {
    return null;
  }
  if (candidate === activeTransport && linked && channelOnline) {
    return "primary";
  }
  if (linked && channelOnline) {
    return "connected";
  }
  return "history";
}

const WIFI_CLEAR_VERIFY_DELAY_MS = 500;
const WIFI_CLEAR_VERIFY_RETRIES = 10;
const DEFAULT_USB_C_DOWNSTREAM_ROUTE: UsbCDownstreamRoute = "mcu";
const DEFAULT_FIXED_VOLTAGES_MV = [9000, 12000, 15000, 20000] as const;

export type JsonlEnvelope<T> = {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string; retryable: boolean };
};

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isWifiClearLikeRequest(
  method: string,
  params?: Record<string, unknown>,
): boolean {
  return (
    method === "wifi.clear" ||
    (method === "settings.reset" && params?.scope === "wifi")
  );
}

function isOtherSettingsResetRequest(
  method: string,
  params?: Record<string, unknown>,
): boolean {
  return method === "settings.reset" && params?.scope === "other";
}

function wifiConfigIsCleared(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const wifi = value as Record<string, unknown>;
  return wifi.configured === false && wifi.psk_configured === false;
}

function wifiClearLikeSuccessValue(
  method: string,
): WifiMutationResponse | SettingsResetResponse {
  if (method === "settings.reset") {
    return { accepted: true, scope: "wifi", reboot_required: false };
  }
  return { accepted: true, reboot_required: false };
}

function otherSettingsResetSuccessValue(): SettingsResetResponse {
  return { accepted: true, scope: "other", wifi_preserved: true };
}

function defaultRouteIsRestored(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const ports = value as Partial<PortsResponse>;
  return (
    ports.hub?.usb_c_downstream_route === DEFAULT_USB_C_DOWNSTREAM_ROUTE &&
    ports.hub.usb_c_downstream_persisted === false
  );
}

function defaultFixedVoltagesAreRestored(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== DEFAULT_FIXED_VOLTAGES_MV.length
  ) {
    return false;
  }
  return DEFAULT_FIXED_VOLTAGES_MV.every(
    (expected, index) => value[index] === expected,
  );
}

function defaultPowerConfigIsRestored(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const config = value as Partial<PowerConfigResponse>;
  const capability = config.capability;
  const protocols = capability?.protocols;
  const pd = capability?.pd;
  const manual = config.manual;
  if (!capability || !protocols || !pd || !manual) {
    return false;
  }
  return (
    config.hardware === "sw2303" &&
    config.persisted === false &&
    config.tps_mode === "auto_follow" &&
    config.light_load_mode === "pfm" &&
    config.sw2303_line_compensation === "50mohm" &&
    capability.profile === "full" &&
    capability.power_watts === 100 &&
    protocols.pd === true &&
    protocols.qc20 === true &&
    protocols.qc30 === true &&
    protocols.fcp === true &&
    protocols.afc === true &&
    protocols.scp === true &&
    protocols.pe20 === true &&
    protocols.bc12 === true &&
    protocols.sfcp === true &&
    pd.pps === true &&
    defaultFixedVoltagesAreRestored(pd.fixed_voltages_mv) &&
    manual.voltage_mv === 5000 &&
    manual.current_limit_ma === 1000 &&
    manual.usb_c_path_mode === "default" &&
    manual.tps_cdc_rise_mv === 0
  );
}

export async function recoverWifiClearLikeTimeout<T>(
  send: (request: JsonlRequest) => Promise<unknown>,
  method: string,
  params?: Record<string, unknown>,
): Promise<Result<T> | null> {
  if (
    !isWifiClearLikeRequest(method, params) &&
    !isOtherSettingsResetRequest(method, params)
  ) {
    return null;
  }
  for (let attempt = 0; attempt < WIFI_CLEAR_VERIFY_RETRIES; attempt += 1) {
    await delayMs(WIFI_CLEAR_VERIFY_DELAY_MS);
    if (isOtherSettingsResetRequest(method, params)) {
      try {
        const portsResponse = await send({
          id: nextJsonlRequestId(),
          method: "ports.get",
          timeoutMs: 1_000,
        });
        const portsEnvelope = portsResponse as JsonlEnvelope<PortsResponse>;
        const portsValue = portsEnvelope?.result ?? portsResponse;

        const powerResponse = await send({
          id: nextJsonlRequestId(),
          method: "power.config_get",
          timeoutMs: 1_000,
        });
        const powerEnvelope =
          powerResponse as JsonlEnvelope<PowerConfigResponse>;
        const powerValue = powerEnvelope?.result ?? powerResponse;

        if (
          defaultRouteIsRestored(portsValue) &&
          defaultPowerConfigIsRestored(powerValue)
        ) {
          return {
            ok: true,
            value: otherSettingsResetSuccessValue() as T,
          };
        }
      } catch {
        // Keep polling until the transport reports the restored default state.
      }
      continue;
    }
    try {
      const response = await send({
        id: nextJsonlRequestId(),
        method: "wifi.get",
        timeoutMs: 1_000,
      });
      const envelope = response as JsonlEnvelope<WifiConfigResponse>;
      const value = envelope?.result ?? response;
      if (wifiConfigIsCleared(value)) {
        return {
          ok: true,
          value: wifiClearLikeSuccessValue(method) as T,
        };
      }
    } catch {
      // Keep polling until the transport reports the cleared state or retries expire.
    }
  }
  return null;
}

export function isDeviceInfoResponse(
  value: unknown,
): value is DeviceInfoResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const device = (value as { device?: unknown }).device;
  return !!device && typeof device === "object";
}
