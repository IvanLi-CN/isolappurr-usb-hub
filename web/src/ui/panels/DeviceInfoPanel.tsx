import { useEffect, useRef, useState } from "react";
import type { DeviceTransport } from "../../app/device-runtime";
import type {
  DeviceInfoResponse,
  RebootResponse,
  Result,
  SettingsResetResponse,
  SettingsResetScope,
  WifiConfigInput,
  WifiConfigResponse,
  WifiMutationResponse,
} from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";
import type { UsbCDownstreamRoute } from "../../domain/ports";
import { ActionButton } from "../actions/ActionButton";
import { ConfirmDialog } from "../actions/ConfirmDialog";
import { DeviceSettingsResetPanel } from "./DeviceSettingsResetPanel";

function unknown(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    return "unknown";
  }
  return value;
}

function transportLabel(transport: DeviceTransport | null): string {
  if (transport === "http") {
    return "Wi-Fi / LAN";
  }
  if (transport === "local_usb") {
    return "Local USB";
  }
  if (transport === "web_serial") {
    return "Web Serial";
  }
  return "Not connected";
}

function InfoFieldRow({
  label,
  value,
  labelWidth,
}: {
  label: string;
  value: string;
  labelWidth: string;
}) {
  return (
    <div
      className="grid min-w-0 items-center gap-x-4 leading-[14px]"
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }}
    >
      <div className="text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
        {label}
      </div>
      <div
        className="min-w-0 truncate font-mono text-[12px] font-semibold"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function DeviceInfoPanel({
  device,
  transport,
  wifiManagementTransport,
  loadInfo,
  loadWifiConfig,
  saveWifiConfig,
  clearWifiConfig,
  resetSettings,
  rebootDevice,
  usbCDownstreamRoute,
  usbCDownstreamPersisted,
  routeBusy,
  setUsbCDownstreamRoute,
  openFirmwareFlashPage,
  deleteDevice,
}: {
  device: StoredDevice;
  transport: DeviceTransport | null;
  wifiManagementTransport: DeviceTransport | null;
  loadInfo: () => Promise<Result<DeviceInfoResponse>>;
  loadWifiConfig: () => Promise<Result<WifiConfigResponse>>;
  saveWifiConfig: (
    input: WifiConfigInput,
  ) => Promise<Result<WifiMutationResponse>>;
  clearWifiConfig: () => Promise<Result<WifiMutationResponse>>;
  resetSettings: (
    scope: SettingsResetScope,
  ) => Promise<Result<SettingsResetResponse>>;
  rebootDevice: () => Promise<Result<RebootResponse>>;
  usbCDownstreamRoute: UsbCDownstreamRoute;
  usbCDownstreamPersisted: boolean | null;
  routeBusy: boolean;
  setUsbCDownstreamRoute: (route: UsbCDownstreamRoute) => Promise<void>;
  openFirmwareFlashPage: () => void;
  deleteDevice: () => Promise<void>;
}) {
  const [info, setInfo] = useState<DeviceInfoResponse | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [wifiConfig, setWifiConfigState] = useState<WifiConfigResponse | null>(
    null,
  );
  const [wifiBusyAction, setWifiBusyAction] = useState<
    "save" | "clear" | "reboot" | null
  >(null);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPsk, setWifiPsk] = useState("");
  const [wifiOpenNetwork, setWifiOpenNetwork] = useState(false);
  const [wifiStatus, setWifiStatus] = useState<string | null>(null);
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [wifiRebootRequired, setWifiRebootRequired] = useState(false);
  const [wifiClearConfirmOpen, setWifiClearConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const loadInfoRef = useRef(loadInfo);
  const loadWifiConfigRef = useRef(loadWifiConfig);
  const wifiFormDirtyRef = useRef(false);

  useEffect(() => {
    loadInfoRef.current = loadInfo;
  }, [loadInfo]);

  useEffect(() => {
    loadWifiConfigRef.current = loadWifiConfig;
  }, [loadWifiConfig]);

  useEffect(() => {
    if (device.id.length === 0) {
      return;
    }
    setInfo(null);
    setInfoError(null);
    setWifiConfigState(null);
    setWifiSsid("");
    setWifiPsk("");
    setWifiOpenNetwork(false);
    setWifiStatus(null);
    setWifiError(null);
    setWifiRebootRequired(false);
    setWifiClearConfirmOpen(false);
    setDeleteConfirmOpen(false);
    setDeleteError(null);
    wifiFormDirtyRef.current = false;
  }, [device.id]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const activeDeviceId = device.id;

    const load = async () => {
      if (!transport || activeDeviceId.length === 0) {
        setInfoError(null);
        return;
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      const res = await loadInfoRef.current();
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setInfo(res.value);
        setInfoError(null);
        retryCount = 0;
      } else {
        setInfoError(res.error.message);
        retryCount = Math.min(retryCount + 1, 5);
      }

      const delayMs = res.ok ? 15_000 : 800 * 2 ** Math.min(retryCount, 3);
      retryTimer = window.setTimeout(() => void load(), delayMs);
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [device.id, transport]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const activeDeviceId = device.id;

    const load = async () => {
      if (!transport || activeDeviceId.length === 0) {
        setWifiError(null);
        return;
      }
      const res = await loadWifiConfigRef.current();
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setWifiConfigState(res.value);
        if (!wifiFormDirtyRef.current) {
          if (res.value.ssid !== undefined) {
            setWifiSsid(res.value.ssid);
          } else if (res.value.configured === false) {
            setWifiSsid("");
          }
        }
        setWifiError(null);
      } else {
        setWifiError(res.error.message);
      }

      const state = res.ok ? res.value.state : null;
      const delayMs = state === "connecting" ? 2_000 : 5_000;
      retryTimer = window.setTimeout(() => void load(), delayMs);
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [device.id, transport]);

  const deviceId = unknown(info?.device.device_id);
  const hostname = unknown(info?.device.hostname);
  const fqdn = unknown(info?.device.fqdn);
  const mac = unknown(info?.device.mac);
  const variant = unknown(info?.device.variant);
  const uptimeMs =
    info?.device.uptime_ms === undefined
      ? "unknown"
      : String(info.device.uptime_ms);

  const fwName = unknown(info?.device.firmware?.name);
  const fwVersion = unknown(info?.device.firmware?.version);
  const fwBuild = "unknown";

  const wifiRuntimeState = wifiConfig?.state ?? info?.device.wifi?.state;
  const wifiRuntimeIpv4 = wifiConfig?.ipv4 ?? info?.device.wifi?.ipv4;
  const wifiRuntimeIsStatic =
    wifiConfig?.is_static ?? info?.device.wifi?.is_static;
  const wifiState = unknown(wifiRuntimeState);
  const wifiIpv4 = unknown(wifiRuntimeIpv4 ?? undefined);
  const wifiIsStatic =
    wifiRuntimeIsStatic === undefined ? "unknown" : String(wifiRuntimeIsStatic);
  const wifiStorage = unknown(wifiConfig?.storage);
  const wifiAddress = unknown(wifiConfig?.address);
  const wifiConfigured =
    wifiConfig?.configured === undefined
      ? wifiConfig?.ssid
        ? "yes"
        : "unknown"
      : wifiConfig.configured
        ? "yes"
        : "no";
  const wifiPskConfigured =
    wifiConfig?.psk_configured === undefined
      ? "unknown"
      : wifiConfig.psk_configured
        ? "yes"
        : "no";
  const wifiCanManage =
    wifiManagementTransport === "web_serial" ||
    wifiManagementTransport === "local_usb";
  const wifiBusy = wifiBusyAction !== null;
  const wifiCanSubmit = wifiCanManage && !wifiBusy;
  const modeDisabled = !transport || routeBusy || modeBusy;
  const selectedMode = usbCDownstreamRoute === "mcu" ? "upgrade" : "normal";

  const setMode = async (mode: "normal" | "upgrade") => {
    const route = mode === "upgrade" ? "mcu" : "usb_c";
    if (modeDisabled || route === usbCDownstreamRoute) {
      return;
    }
    setModeBusy(true);
    try {
      await setUsbCDownstreamRoute(route);
    } finally {
      setModeBusy(false);
    }
  };

  const saveWifi = async () => {
    const nextPsk = wifiOpenNetwork ? "" : wifiPsk;
    const nextSsid = wifiSsid;
    if (!wifiCanManage) {
      setWifiError(
        "Connect with Web Serial or Local USB before changing Wi-Fi configuration.",
      );
      return;
    }
    const validationError = validateWifiInput(wifiSsid, nextPsk);
    if (validationError) {
      setWifiError(validationError);
      return;
    }
    if (
      wifiConfig?.psk_configured === true &&
      nextPsk.length === 0 &&
      !wifiOpenNetwork
    ) {
      setWifiError(
        "Enter the Wi-Fi PSK again before saving, or choose Open network to replace the stored PSK.",
      );
      return;
    }

    setWifiBusyAction("save");
    setWifiError(null);
    setWifiStatus(null);
    try {
      const res = await saveWifiConfig({
        ssid: nextSsid,
        psk: nextPsk,
      });
      if (res.ok) {
        setWifiConfigState((prev) => ({
          ...prev,
          storage: prev?.storage ?? "eeprom",
          address: prev?.address ?? "0x50",
          configured: true,
          ssid: nextSsid,
          psk_configured: nextPsk.length > 0,
          state: res.value.reboot_required ? prev?.state : "connecting",
          ipv4: res.value.reboot_required ? prev?.ipv4 : null,
          is_static: prev?.is_static,
        }));
        setWifiPsk("");
        setWifiOpenNetwork(false);
        wifiFormDirtyRef.current = false;
        setWifiRebootRequired(res.value.reboot_required);
        setWifiStatus(
          res.value.reboot_required
            ? "Wi-Fi configuration saved. Reboot this hub to apply it."
            : "Wi-Fi configuration saved and applying now.",
        );
        return;
      }
      setWifiError(res.error.message);
    } finally {
      setWifiBusyAction(null);
    }
  };

  const requestClearWifi = () => {
    if (!wifiCanManage) {
      setWifiError(
        "Connect with Web Serial or Local USB before changing Wi-Fi configuration.",
      );
      return;
    }
    setWifiError(null);
    setWifiClearConfirmOpen(true);
  };

  const clearWifi = async () => {
    setWifiBusyAction("clear");
    setWifiError(null);
    setWifiStatus(null);
    setWifiClearConfirmOpen(false);
    try {
      const res = await clearWifiConfig();
      if (res.ok) {
        setWifiConfigState((prev) => ({
          storage: prev?.storage ?? "eeprom",
          address: prev?.address ?? "0x50",
          configured: false,
          psk_configured: false,
          state: res.value.reboot_required ? prev?.state : "idle",
          ipv4: res.value.reboot_required ? prev?.ipv4 : null,
          is_static: res.value.reboot_required ? prev?.is_static : false,
        }));
        setWifiSsid("");
        setWifiPsk("");
        setWifiOpenNetwork(false);
        wifiFormDirtyRef.current = false;
        setWifiRebootRequired(res.value.reboot_required);
        setWifiStatus(
          res.value.reboot_required
            ? "Wi-Fi configuration cleared. Reboot this hub to apply it."
            : "Wi-Fi configuration cleared and Wi-Fi is stopping.",
        );
        return;
      }
      setWifiError(res.error.message);
    } finally {
      setWifiBusyAction(null);
    }
  };

  const handleWifiSettingsReset = (rebootRequired: boolean) => {
    setWifiConfigState((prev) => ({
      storage: prev?.storage ?? "eeprom",
      address: prev?.address ?? "0x50",
      configured: false,
      psk_configured: false,
      state: rebootRequired ? prev?.state : "idle",
      ipv4: rebootRequired ? prev?.ipv4 : null,
      is_static: rebootRequired ? prev?.is_static : false,
    }));
    setWifiSsid("");
    setWifiPsk("");
    setWifiOpenNetwork(false);
    setWifiRebootRequired(rebootRequired);
    wifiFormDirtyRef.current = false;
  };

  const rebootForWifi = async () => {
    if (!wifiCanManage) {
      setWifiError(
        "Connect with Web Serial or Local USB before applying Wi-Fi configuration changes.",
      );
      return;
    }
    setWifiBusyAction("reboot");
    setWifiError(null);
    try {
      const res = await rebootDevice();
      if (res.ok) {
        setWifiRebootRequired(false);
        setWifiStatus("Reboot accepted. The hub may disconnect briefly.");
        return;
      }
      setWifiError(res.error.message);
    } finally {
      setWifiBusyAction(null);
    }
  };

  const confirmDeleteDevice = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDevice();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete this hub.",
      );
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="device-info">
      <div className="iso-card min-h-[168px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-[16px] font-bold leading-5">Identity</div>
        <div className="mt-[14px] grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,564px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-[10px]">
            <InfoFieldRow
              label="device_id"
              value={deviceId}
              labelWidth="84px"
            />
            <InfoFieldRow label="hostname" value={hostname} labelWidth="84px" />
            <InfoFieldRow label="fqdn" value={fqdn} labelWidth="84px" />
            <InfoFieldRow label="mac" value={mac} labelWidth="84px" />
          </div>

          <div className="flex flex-col gap-[10px]">
            <InfoFieldRow label="variant" value={variant} labelWidth="70px" />
            <InfoFieldRow
              label="uptime_ms"
              value={uptimeMs}
              labelWidth="90px"
            />
          </div>
        </div>
        {infoError ? (
          <div
            className="mt-4 rounded-[10px] border border-[var(--error)] px-3 py-2 text-[12px] font-semibold leading-5 text-[var(--error)]"
            role="alert"
          >
            {transportLabel(transport)} info failed: {infoError}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="iso-card h-[152px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="text-[16px] font-bold leading-5">Firmware</div>
          <div className="mt-[14px] flex flex-col gap-[10px] leading-[14px]">
            <InfoFieldRow label="name" value={fwName} labelWidth="54px" />
            <InfoFieldRow label="version" value={fwVersion} labelWidth="64px" />
            <InfoFieldRow label="build" value={fwBuild} labelWidth="54px" />
          </div>
        </div>

        <div className="iso-card h-[152px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="text-[16px] font-bold leading-5">WiFi</div>
          <div className="mt-[14px] flex flex-col gap-[10px] leading-[14px]">
            <InfoFieldRow label="state" value={wifiState} labelWidth="50px" />
            <InfoFieldRow label="ipv4" value={wifiIpv4} labelWidth="40px" />
            <InfoFieldRow
              label="is_static"
              value={wifiIsStatic}
              labelWidth="70px"
            />
          </div>
        </div>
      </div>

      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-5">USB-C mode</div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Normal uses the USB-C data path. Upgrade routes downstream USB to
              the MCU and stores the choice in EEPROM.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex h-10 w-full rounded-[12px] border border-[var(--border)] p-1 sm:w-[260px]">
              {(
                [
                  ["normal", "Normal"],
                  ["upgrade", "Upgrade"],
                ] as const
              ).map(([mode, label]) => {
                const active = selectedMode === mode;
                return (
                  <button
                    className={[
                      "flex h-8 flex-1 items-center justify-center rounded-[10px] text-[12px] font-bold",
                      modeDisabled
                        ? "text-[var(--btn-disabled-text)]"
                        : active
                          ? "bg-[var(--primary)] text-[var(--primary-text)]"
                          : "bg-transparent text-[var(--text)]",
                    ].join(" ")}
                    type="button"
                    disabled={modeDisabled || active}
                    key={mode}
                    onClick={() => void setMode(mode)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {usbCDownstreamPersisted === false ? (
              <div className="flex min-h-8 items-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] font-bold whitespace-nowrap text-[var(--badge-warning-text)]">
                EEPROM not saved
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-5">
              Wi-Fi configuration
            </div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Stored credentials live in EEPROM U21 and apply immediately.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex min-h-8 items-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] font-bold text-[var(--muted)]">
              Current: {transportLabel(transport)}
            </div>
            <div className="flex min-h-8 items-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] font-bold text-[var(--muted)]">
              Manage: {transportLabel(wifiManagementTransport)}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoPill label="state" value={wifiState} />
          <InfoPill label="ipv4" value={wifiIpv4} />
          <InfoPill label="static" value={wifiIsStatic} />
          <InfoPill label="configured" value={wifiConfigured} />
          <InfoPill label="psk" value={wifiPskConfigured} />
          <InfoPill label="storage" value={wifiStorage} />
          <InfoPill label="address" value={wifiAddress} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="form-control min-w-0">
            <div className="label px-0 pb-1 pt-0">
              <span className="label-text text-[12px] font-bold text-[var(--muted)]">
                SSID
              </span>
            </div>
            <input
              className="input input-sm w-full font-mono"
              autoComplete="off"
              value={wifiSsid}
              disabled={!wifiCanManage || wifiBusy}
              onChange={(event) => {
                wifiFormDirtyRef.current = true;
                setWifiSsid(event.target.value);
              }}
              placeholder="Network name"
            />
          </label>
          <div className="min-w-0">
            <label className="form-control min-w-0">
              <div className="label px-0 pb-1 pt-0">
                <span className="label-text text-[12px] font-bold text-[var(--muted)]">
                  PSK
                </span>
              </div>
              <input
                className="input input-sm w-full font-mono"
                type="password"
                autoComplete="new-password"
                value={wifiPsk}
                disabled={!wifiCanManage || wifiBusy || wifiOpenNetwork}
                onChange={(event) => {
                  wifiFormDirtyRef.current = true;
                  setWifiPsk(event.target.value);
                  if (event.target.value.length > 0) {
                    setWifiOpenNetwork(false);
                  }
                }}
                placeholder="Blank means open network"
              />
            </label>
            <label className="mt-2 flex min-h-6 items-center gap-2 text-[12px] font-semibold text-[var(--muted)]">
              <input
                className="checkbox checkbox-xs"
                type="checkbox"
                checked={wifiOpenNetwork}
                disabled={!wifiCanManage || wifiBusy}
                onChange={(event) => {
                  const checked = event.target.checked;
                  wifiFormDirtyRef.current = true;
                  setWifiOpenNetwork(checked);
                  if (checked) {
                    setWifiPsk("");
                  }
                }}
              />
              <span>Open network (no PSK)</span>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-[12px] font-semibold leading-5 text-[var(--muted)]">
            {wifiCanManage
              ? "Existing PSK is never shown. Re-enter it before saving a secured network, or choose Open network to replace it."
              : "Wi-Fi/LAN is read-only for Wi-Fi settings. Connect with Web Serial or Local USB to change credentials."}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:min-w-[260px]">
            <ActionButton
              fullWidth
              loading={wifiBusyAction === "save"}
              tone="primary"
              disabled={!wifiCanSubmit}
              onClick={() => void saveWifi()}
            >
              Save Wi-Fi
            </ActionButton>
            <ActionButton
              fullWidth
              tone="warning"
              disabled={!wifiCanSubmit}
              onClick={requestClearWifi}
            >
              Clear
            </ActionButton>
            {wifiRebootRequired ? (
              <ActionButton
                fullWidth
                loading={wifiBusyAction === "reboot"}
                tone="secondary"
                disabled={!wifiCanSubmit}
                onClick={() => void rebootForWifi()}
              >
                Reboot
              </ActionButton>
            ) : null}
          </div>
        </div>

        {wifiStatus ? (
          <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold text-[var(--muted)]">
            {wifiStatus}
          </div>
        ) : null}

        {wifiError ? (
          <div
            className="mt-4 rounded-[12px] border border-[var(--error)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]"
            role="alert"
          >
            Wi-Fi configuration failed: {wifiError}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        busy={wifiBusyAction === "clear"}
        confirmLabel="Clear Wi-Fi"
        description="The hub will forget the saved SSID and PSK, and Wi-Fi will stop immediately."
        open={wifiClearConfirmOpen}
        title="Clear stored Wi-Fi configuration?"
        tone="warning"
        onCancel={() => setWifiClearConfirmOpen(false)}
        onConfirm={() => void clearWifi()}
      />

      <ConfirmDialog
        busy={deleteBusy}
        confirmLabel="Delete device"
        description={`This only removes the local saved profile for ${device.name}. It does not change hardware settings on the hub.`}
        open={deleteConfirmOpen}
        title="Delete this saved device?"
        tone="danger"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void confirmDeleteDevice()}
      />

      <DeviceSettingsResetPanel
        key={device.id}
        transport={transport}
        transportLabel={transportLabel(transport)}
        wifiCanManage={wifiCanManage}
        resetSettings={resetSettings}
        onWifiResetSuccess={handleWifiSettingsReset}
      />

      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-5">
              Firmware flash workbench
            </div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Open the standalone USB-only workbench for bundled release
              installs, recovery, and manual app-image flashing.
            </div>
          </div>
          <ActionButton tone="primary" onClick={openFirmwareFlashPage}>
            Open firmware flash
          </ActionButton>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <InfoPill label="firmware" value={fwVersion} />
          <InfoPill label="transport" value={transportLabel(transport)} />
          <InfoPill label="source" value="Bundled releases + local file" />
        </div>
      </div>

      <div className="iso-card h-[156px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-[16px] font-bold leading-5">Notes</div>
        <div className="mt-[14px] space-y-[6px] text-[14px] font-medium leading-5">
          <div>- Missing fields render as “unknown”</div>
          <div>- Connection: offline when last ok ≥ 10s</div>
          <div>- UI labels default English; i18n later</div>
        </div>
      </div>

      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-5">Saved device</div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Remove this hub from the local device list.
            </div>
          </div>
          <ActionButton
            tone="danger"
            onClick={() => {
              setDeleteError(null);
              setDeleteConfirmOpen(true);
            }}
          >
            Delete device
          </ActionButton>
        </div>
        {deleteError ? (
          <div
            className="mt-4 rounded-[12px] border border-[var(--error)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]"
            role="alert"
          >
            {deleteError}
          </div>
        ) : null}
      </div>

      <div className="text-[12px] font-semibold text-[var(--muted)]">
        Settings includes device info plus persistent Wi-Fi, USB-C mode, and a
        shortcut to the standalone flash workbench.
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
      <div className="text-[11px] font-bold uppercase leading-4 text-[var(--muted)]">
        {label}
      </div>
      <div className="min-w-0 truncate font-mono text-[12px] font-semibold leading-5">
        {value}
      </div>
    </div>
  );
}

function validateWifiInput(ssid: string, psk: string): string | null {
  const ssidBytes = utf8ByteLength(ssid);
  if (ssidBytes === 0) {
    return "SSID is required.";
  }
  if (ssidBytes > 32) {
    return "SSID must be 32 bytes or fewer.";
  }

  const pskBytes = utf8ByteLength(psk);
  if (pskBytes > 0 && pskBytes < 8) {
    return "PSK must be blank or at least 8 bytes.";
  }
  if (pskBytes > 64) {
    return "PSK must be 64 bytes or fewer.";
  }
  return null;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
