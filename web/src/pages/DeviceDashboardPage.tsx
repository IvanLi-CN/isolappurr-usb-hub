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

  return (
    <div className="flex flex-col gap-4" data-testid="device-overview-page">
      <div>
        <DevicePageTabs deviceId={deviceId} />
      </div>
      <div>
        <DeviceDashboardPanel device={device} />
      </div>
    </div>
  );
}
