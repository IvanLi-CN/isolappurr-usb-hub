import { useEffect, useState } from "react";
import {
  type DeviceApiError,
  type DeviceInfoResponse,
  getDeviceInfo,
} from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";

export function DeviceInfoPanel({ device }: { device: StoredDevice }) {
  const [info, setInfo] = useState<DeviceInfoResponse | null>(null);
  const [error, setError] = useState<DeviceApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await getDeviceInfo(device.baseUrl);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setInfo(res.value);
        setError(null);
        return;
      }
      setError(res.error);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [device.baseUrl]);

  return (
    <div className="flex flex-col gap-4" data-testid="device-info">
      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">Identity</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs opacity-70">deviceId</div>
            <div className="font-mono text-sm">{device.id}</div>
          </div>
          <div>
            <div className="text-xs opacity-70">name</div>
            <div className="text-sm">{device.name}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs opacity-70">baseUrl</div>
            <div className="font-mono text-sm">{device.baseUrl}</div>
          </div>
        </div>
      </div>

      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">Device (live)</div>
        {error ? (
          <div className="mt-2 text-sm opacity-80">
            Error: {error.kind} ({error.message})
          </div>
        ) : null}
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs opacity-70">hostname</div>
            <div className="font-mono text-sm">
              {info?.device.hostname ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-70">fqdn</div>
            <div className="font-mono text-sm">{info?.device.fqdn ?? "—"}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs opacity-70">mac</div>
            <div className="font-mono text-sm">{info?.device.mac ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs opacity-70">wifi state</div>
            <div className="font-mono text-sm">
              {info?.device.wifi.state ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-70">ipv4</div>
            <div className="font-mono text-sm">
              {info?.device.wifi.ipv4 ?? "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">Firmware</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs opacity-70">variant</div>
            <div className="font-mono text-sm">
              {info?.device.variant ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs opacity-70">version</div>
            <div className="font-mono text-sm">
              {info
                ? `${info.device.firmware.name} ${info.device.firmware.version}`
                : "—"}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs opacity-70">uptime_ms</div>
            <div className="font-mono text-sm">
              {info?.device.uptime_ms ?? "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
