import { useParams } from "react-router";
import { useDemoNavigate } from "../app/demo-navigation";
import { useDeviceRuntime } from "../app/device-runtime";
import { useDevices } from "../app/devices-store";
import { MissingDeviceState } from "../ui/errors/MissingDeviceState";
import { DevicePageTabs } from "../ui/nav/DevicePageTabs";
import { DeviceInfoPanel } from "../ui/panels/DeviceInfoPanel";

export function DeviceInfoPage() {
  const { deviceId } = useParams();
  const { getDevice, removeDevice } = useDevices();
  const navigate = useDemoNavigate();
  const runtime = useDeviceRuntime();

  if (!deviceId) {
    return null;
  }

  const device = getDevice(deviceId);
  if (!device) {
    return <MissingDeviceState />;
  }
  const deviceRuntime = runtime.runtimeById[device.id];

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
        <DeviceInfoPanel
          device={device}
          transport={runtime.transport(device.id)}
          wifiManagementTransport={runtime.wifiManagementTransport(device.id)}
          sharedCommand={deviceRuntime?.command ?? null}
          sharedRevision={deviceRuntime?.revision ?? 0}
          loadInfo={() => runtime.deviceInfo(device.id)}
          loadWifiConfig={() => runtime.wifiConfig(device.id)}
          saveWifiConfig={(input) => runtime.saveWifiConfig(device.id, input)}
          clearWifiConfig={() => runtime.clearWifiConfig(device.id)}
          resetSettings={(scope) => runtime.resetSettings(device.id, scope)}
          rebootDevice={() => runtime.rebootDevice(device.id)}
          usbCDownstreamRoute={
            runtime.hub(device.id)?.usb_c_downstream_route ?? "usb_c"
          }
          usbCDownstreamPersisted={
            runtime.hub(device.id)?.usb_c_downstream_persisted ?? null
          }
          routeBusy={runtime.pending(device.id, "port_c")}
          setUsbCDownstreamRoute={(route) =>
            runtime.setUsbCDownstreamRoute(device.id, route)
          }
          openFirmwareFlashPage={() =>
            navigate(`/flash?deviceId=${encodeURIComponent(device.id)}`)
          }
          deleteDevice={async () => {
            await removeDevice(device.id);
            navigate("/");
          }}
        />
      </div>
    </div>
  );
}
