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
            Back to devices
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <DevicePageTabs deviceId={deviceId} />
      <DeviceInfoPanel device={device} />
    </div>
  );
}
