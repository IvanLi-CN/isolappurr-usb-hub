import { Link, useParams } from "react-router";
import { useDevices } from "../app/devices-store";
import { DevicePageTabs } from "../ui/nav/DevicePageTabs";
import { DeviceInfoPanel } from "../ui/panels/DeviceInfoPanel";

export function DeviceInfoPage() {
  const { deviceId } = useParams();
  const { getDevice } = useDevices();

  if (!deviceId) {
    return null;
  }

  const device = getDevice(deviceId);
  if (!device) {
    return (
      <div className="flex flex-col gap-3" data-testid="device-not-found">
        <div className="text-lg font-semibold">Device not found</div>
        <div className="text-sm opacity-80">
          Choose an existing device or add a new one.
        </div>
        <div>
          <Link className="link" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const shortId = device.id.length > 6 ? device.id.slice(0, 6) : device.id;

  return (
    <div className="flex flex-col" data-testid="device-hardware-page">
      <div>
        <div className="text-[24px] font-bold">{device.name}</div>
        <div className="mt-2 truncate font-mono text-[12px] font-semibold text-[var(--muted)]">
          id: {shortId} • {device.baseUrl}
        </div>
      </div>

      <div className="mt-4">
        <DevicePageTabs deviceId={deviceId} />
      </div>

      <div className="mt-[22px]">
        <DeviceInfoPanel device={device} />
      </div>
    </div>
  );
}
