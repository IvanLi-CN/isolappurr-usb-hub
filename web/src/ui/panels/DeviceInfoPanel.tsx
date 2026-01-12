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

    const load = async () => {
      const res = await getDeviceInfo(device.baseUrl);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setInfo(res.value);
        return;
      }
      setInfo(null);
    };

    void load();
    return () => {
      cancelled = true;
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
      <div className="iso-card h-[168px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-6 py-6">
        <div className="text-[16px] font-bold">Identity</div>
        <div className="mt-4 grid grid-cols-2 gap-6 leading-4">
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center">
              <div className="w-[84px] text-[12px] font-semibold text-[var(--muted)]">
                device_id
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {deviceId}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[84px] text-[12px] font-semibold text-[var(--muted)]">
                hostname
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {hostname}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[84px] text-[12px] font-semibold text-[var(--muted)]">
                fqdn
              </div>
              <div className="font-mono text-[12px] font-semibold">{fqdn}</div>
            </div>
            <div className="flex items-center">
              <div className="w-[84px] text-[12px] font-semibold text-[var(--muted)]">
                mac
              </div>
              <div className="font-mono text-[12px] font-semibold">{mac}</div>
            </div>
          </div>

          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center">
              <div className="w-[70px] text-[12px] font-semibold text-[var(--muted)]">
                variant
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {variant}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[90px] text-[12px] font-semibold text-[var(--muted)]">
                uptime_ms
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {uptimeMs}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="iso-card h-[152px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-6 py-6">
          <div className="text-[16px] font-bold">Firmware</div>
          <div className="mt-4 flex flex-col gap-[10px] leading-4">
            <div className="flex items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                name
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {fwName}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[64px] text-[12px] font-semibold text-[var(--muted)]">
                version
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {fwVersion}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
                build
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {fwBuild}
              </div>
            </div>
          </div>
        </div>

        <div className="iso-card h-[152px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-6 py-6">
          <div className="text-[16px] font-bold">WiFi</div>
          <div className="mt-4 flex flex-col gap-[10px] leading-4">
            <div className="flex items-center">
              <div className="w-[50px] text-[12px] font-semibold text-[var(--muted)]">
                state
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {wifiState}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-10 text-[12px] font-semibold text-[var(--muted)]">
                ipv4
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {wifiIpv4}
              </div>
            </div>
            <div className="flex items-center">
              <div className="w-[70px] text-[12px] font-semibold text-[var(--muted)]">
                is_static
              </div>
              <div className="font-mono text-[12px] font-semibold">
                {wifiIsStatic}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="iso-card h-[156px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-6 py-6">
        <div className="text-[16px] font-bold">Notes</div>
        <div className="mt-4 space-y-[6px] text-[14px] font-medium leading-5">
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
