import { useEffect, useState } from "react";
import { type DeviceInfoResponse, getDeviceInfo } from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";

function unknown(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    return "unknown";
  }
  return value;
}

export function DeviceInfoPanel({ device }: { device: StoredDevice }) {
  const [info, setInfo] = useState<DeviceInfoResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    let retryCount = 0;

    const load = async () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      const res = await getDeviceInfo(device.baseUrl);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setInfo(res.value);
        retryCount = 0;
      } else {
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
  }, [device.baseUrl]);

  const deviceId = unknown(info?.device.device_id);
  const hostname = unknown(info?.device.hostname);
  const fqdn = unknown(info?.device.fqdn);
  const mac = unknown(info?.device.mac);
  const variant = unknown(info?.device.variant);
  const uptimeMs =
    info?.device.uptime_ms === undefined
      ? "unknown"
      : String(info.device.uptime_ms);

  const fwName = unknown(info?.device.firmware.name);
  const fwVersion = unknown(info?.device.firmware.version);
  const fwBuild = "unknown";

  const wifiState = unknown(info?.device.wifi.state);
  const wifiIpv4 = unknown(info?.device.wifi.ipv4 ?? undefined);
  const wifiIsStatic =
    info?.device.wifi.is_static === undefined
      ? "unknown"
      : String(info.device.wifi.is_static);

  return (
    <div className="flex flex-col gap-6" data-testid="device-info">
      <div className="iso-card h-[168px] rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
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
