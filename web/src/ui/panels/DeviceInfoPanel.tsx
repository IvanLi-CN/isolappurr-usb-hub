import type { StoredDevice } from "../../domain/devices";
import { mockDeviceNetworkInfo } from "../../domain/mock";

export function DeviceInfoPanel({ device }: { device: StoredDevice }) {
  const info = mockDeviceNetworkInfo(device.id);

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
        <div className="text-sm font-semibold">Network (mock)</div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs opacity-70">ip</div>
            <div className="font-mono text-sm">{info.ip}</div>
          </div>
          <div>
            <div className="text-xs opacity-70">hostname</div>
            <div className="font-mono text-sm">{info.hostname}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs opacity-70">mac</div>
            <div className="font-mono text-sm">{info.mac}</div>
          </div>
        </div>
      </div>

      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">MCU (mock)</div>
        <div className="mt-2">
          <div className="text-xs opacity-70">unique id</div>
          <div className="font-mono text-sm">{info.mcu_unique_id}</div>
        </div>
      </div>
    </div>
  );
}
