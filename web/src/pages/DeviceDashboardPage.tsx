import { useParams } from "react-router";
import { useDevices } from "../app/devices-store";
import { MissingDeviceState } from "../ui/errors/MissingDeviceState";
import { DevicePageTabs } from "../ui/nav/DevicePageTabs";
import { DeviceDashboardPanel } from "../ui/panels/DeviceDashboardPanel";

export function DeviceDashboardPage() {
  const { deviceId } = useParams();
  const { getDevice } = useDevices();

  if (!deviceId) {
    return null;
  }

  const device = getDevice(deviceId);
  if (!device) {
    return <MissingDeviceState />;
  }

  const shortId = device.id.length > 6 ? device.id.slice(0, 6) : device.id;

  return (
    <div className="flex flex-col" data-testid="device-overview-page">
      <div>
        <div className="text-[24px] font-bold">{device.name}</div>
        <div className="mt-2 truncate font-mono text-[12px] font-semibold text-[var(--muted)]">
          id: {shortId} • {device.baseUrl}
        </div>
      </div>

      <div className="mt-4">
        <DevicePageTabs deviceId={deviceId} />
      </div>

      <div className="mt-[14px]">
        <DeviceDashboardPanel device={device} />
      </div>
    </div>
  );
}
