import { useEffect, useRef, useState } from "react";
import type { DeviceTransport } from "../../app/device-runtime";
import {
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../../domain/desktopAgent";
import type { DeviceInfoResponse, Result } from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";
import {
  type FirmwareFlashProgress,
  flashWithLocalUsb,
  flashWithWebSerial,
  isWebSerialSupported,
  nextJsonlRequestId,
  WebSerialJsonlTransport,
} from "../../domain/hardwareConsole";
import { getLocalUsbDeviceLink } from "../../domain/localUsbLinks";
import {
  getWebSerialDeviceTransport,
  setWebSerialDeviceTransport,
} from "../../domain/webSerialLinks";

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

export function DeviceInfoPanel({
  device,
  transport,
  loadInfo,
}: {
  device: StoredDevice;
  transport: DeviceTransport | null;
  loadInfo: () => Promise<Result<DeviceInfoResponse>>;
}) {
  const [info, setInfo] = useState<DeviceInfoResponse | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const [flashAddress, setFlashAddress] = useState("0x10000");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashStatus, setFlashStatus] = useState<string | null>(null);
  const [flashError, setFlashError] = useState<string | null>(null);
  const [flashProgress, setFlashProgress] =
    useState<FirmwareFlashProgress | null>(null);
  const loadInfoRef = useRef(loadInfo);

  useEffect(() => {
    loadInfoRef.current = loadInfo;
  }, [loadInfo]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;
    const activeDeviceId = device.id;

    const load = async () => {
      if (!transport || activeDeviceId.length === 0) {
        setInfo(null);
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
  const webSerialSupported = isWebSerialSupported();
  const firmwarePath =
    transport === "local_usb" || transport === "web_serial" ? transport : null;
  const firmwarePathLabel = transportLabel(transport);
  const firmwareUnavailableReason =
    transport === "http"
      ? "Firmware flashing is disabled over Wi-Fi/LAN because OTA is not implemented yet."
      : !firmwarePath
        ? "Connect this hub with Web Serial or Local USB to flash firmware."
        : null;

  const wifiState = unknown(info?.device.wifi?.state);
  const wifiIpv4 = unknown(info?.device.wifi?.ipv4 ?? undefined);
  const wifiIsStatic =
    info?.device.wifi?.is_static === undefined
      ? "unknown"
      : String(info.device.wifi.is_static);

  const resolveLocalUsbFlashPort = async (): Promise<{
    agent: DesktopAgent;
    portPath: string;
  }> => {
    const agent = await tryBootstrapDesktopAgent();
    if (!agent) {
      throw new Error("Local USB service is not running.");
    }
    const linkedPort = getLocalUsbDeviceLink(device.id);
    if (!linkedPort) {
      throw new Error(
        "Reconnect this hub with Local USB from Add Device before flashing firmware.",
      );
    }
    return { agent, portPath: linkedPort };
  };

  const flashFirmware = async () => {
    if (!firmwarePath) {
      setFlashError(
        "Firmware flashing requires Web Serial or Local USB. OTA over Wi-Fi/LAN is not implemented yet.",
      );
      return;
    }
    if (!firmwareFile) {
      setFlashError("Select a firmware .bin first.");
      return;
    }
    const address = parseFlashAddress(flashAddress);
    if (address === null) {
      setFlashError("Enter a valid flash address, for example 0x10000.");
      return;
    }

    setFlashBusy(true);
    setFlashError(null);
    setFlashProgress(null);
    try {
      if (firmwarePath === "local_usb") {
        setFlashStatus("Using the linked Local USB port...");
        const resolved = await resolveLocalUsbFlashPort();
        setFlashStatus("Writing firmware over Local USB...");
        const output = await flashWithLocalUsb(
          resolved.agent,
          resolved.portPath,
          firmwareFile,
          address,
        );
        setFlashStatus(output || "Firmware update completed over Local USB.");
        return;
      }

      if (!webSerialSupported) {
        throw new Error("Web Serial is not supported by this browser.");
      }
      const currentTransport = getWebSerialDeviceTransport(device.id);
      if (!currentTransport) {
        throw new Error(
          "Connect this hub with Web Serial before flashing firmware.",
        );
      }
      setFlashStatus(
        "Preparing connected Web Serial port for firmware update...",
      );
      const port = await currentTransport.takePortForExclusiveUse();
      let firmwareWritten = false;
      try {
        setFlashStatus("Writing firmware over the current Web Serial link...");
        await flashWithWebSerial(port, firmwareFile, address, setFlashProgress);
        firmwareWritten = true;
        setFlashStatus("Firmware update completed over Web Serial.");
      } finally {
        try {
          if (firmwareWritten) {
            await restoreWebSerialTransport(device.id);
          } else {
            const restoredTransport = new WebSerialJsonlTransport();
            await delay(250);
            await restoredTransport.connectToPort(port);
            setWebSerialDeviceTransport(device.id, restoredTransport);
          }
        } catch {
          // The hub may still be re-enumerating after a successful flash.
        }
      }
    } catch (err) {
      setFlashError(
        err instanceof Error ? err.message : "Firmware update failed.",
      );
    } finally {
      setFlashBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="device-info">
      <div className="iso-card min-h-[168px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-[16px] font-bold leading-5">Identity</div>
        <div className="mt-[14px] grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,564px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-[10px]">
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[84px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                device_id
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {deviceId}
              </div>
            </div>
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[84px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                hostname
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {hostname}
              </div>
            </div>
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[84px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                fqdn
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {fqdn}
              </div>
            </div>
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[84px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                mac
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {mac}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-[10px]">
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[70px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                variant
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {variant}
              </div>
            </div>
            <div className="flex min-w-0 items-center leading-[14px]">
              <div className="w-[90px] text-[12px] font-semibold leading-[14px] text-[var(--muted)]">
                uptime_ms
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {uptimeMs}
              </div>
            </div>
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
            <div className="flex min-w-0 items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                name
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {fwName}
              </div>
            </div>
            <div className="flex min-w-0 items-center">
              <div className="w-[64px] text-[12px] font-semibold text-[var(--muted)]">
                version
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {fwVersion}
              </div>
            </div>
            <div className="flex min-w-0 items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                build
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {fwBuild}
              </div>
            </div>
          </div>
        </div>

        <div className="iso-card h-[152px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="text-[16px] font-bold leading-5">WiFi</div>
          <div className="mt-[14px] flex flex-col gap-[10px] leading-[14px]">
            <div className="flex min-w-0 items-center">
              <div className="w-[50px] text-[12px] font-semibold text-[var(--muted)]">
                state
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {wifiState}
              </div>
            </div>
            <div className="flex min-w-0 items-center">
              <div className="w-10 text-[12px] font-semibold text-[var(--muted)]">
                ipv4
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {wifiIpv4}
              </div>
            </div>
            <div className="flex min-w-0 items-center">
              <div className="w-[70px] text-[12px] font-semibold text-[var(--muted)]">
                is_static
              </div>
              <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
                {wifiIsStatic}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[16px] font-bold leading-5">
              Firmware update
            </div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Update this saved hub with an ESP32-S3 app image `.bin` at
              0x10000.
            </div>
          </div>
          <div className="flex min-h-8 items-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] font-bold text-[var(--muted)]">
            Current: {firmwarePathLabel}
          </div>
        </div>

        {firmwareUnavailableReason ? (
          <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold text-[var(--muted)]">
            {firmwareUnavailableReason}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_132px]">
          <input
            className="file-input file-input-sm w-full"
            type="file"
            accept=".bin,application/octet-stream"
            onChange={(event) =>
              setFirmwareFile(event.currentTarget.files?.[0] ?? null)
            }
          />
          <input
            className="input input-sm w-full font-mono"
            aria-label="Flash address"
            value={flashAddress}
            onChange={(event) => setFlashAddress(event.target.value)}
          />
        </div>

        {firmwarePath === "web_serial" && !webSerialSupported ? (
          <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold text-[var(--warning)]">
            This browser does not expose Web Serial. Use Chrome/Edge or Local
            USB.
          </div>
        ) : null}

        {flashProgress ? (
          <div className="mt-4 text-[12px] font-semibold text-[var(--muted)]">
            {flashProgress.message}
            {flashProgress.total
              ? ` ${Math.round(((flashProgress.written ?? 0) / flashProgress.total) * 100)}%`
              : ""}
          </div>
        ) : null}

        {flashStatus ? (
          <div className="mt-4 text-[12px] font-semibold text-[var(--muted)]">
            {flashStatus}
          </div>
        ) : null}

        {flashError ? (
          <div
            className="mt-4 rounded-[12px] border border-[var(--error)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]"
            role="alert"
          >
            {flashError}
          </div>
        ) : null}

        <button
          className="btn btn-primary mt-5 h-11 w-full justify-center"
          type="button"
          disabled={
            flashBusy ||
            !firmwareFile ||
            !firmwarePath ||
            (firmwarePath === "web_serial" && !webSerialSupported)
          }
          onClick={() => void flashFirmware()}
        >
          {flashBusy ? "Updating..." : "Flash firmware"}
        </button>
      </div>

      <div className="iso-card h-[156px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
        <div className="text-[16px] font-bold leading-5">Notes</div>
        <div className="mt-[14px] space-y-[6px] text-[14px] font-medium leading-5">
          <div>- Missing fields render as “unknown”</div>
          <div>- Connection: offline when last ok ≥ 10s</div>
          <div>- UI labels default English; i18n later</div>
        </div>
      </div>

      <div className="text-[12px] font-semibold text-[var(--muted)]">
        Hardware tab maps directly to Plan #0005 /api/v1/info fields.
      </div>
    </div>
  );
}

function parseFlashAddress(value: string): number | null {
  const trimmed = value.trim();
  if (!/^0x[0-9a-f]+$/i.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function restoreWebSerialTransport(deviceId: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const restoredTransport = new WebSerialJsonlTransport();
    try {
      await delay(1_000 + attempt * 500);
      await restoredTransport.connectGranted();
      await restoredTransport.request({
        id: nextJsonlRequestId(),
        method: "info",
        timeoutMs: 2_000,
      });
      setWebSerialDeviceTransport(deviceId, restoredTransport);
      return;
    } catch {
      await restoredTransport.disconnect().catch(() => undefined);
    }
  }
}
