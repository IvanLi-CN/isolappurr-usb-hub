import { useAddDeviceUi } from "../../app/add-device-ui";
import { useDeviceRuntime } from "../../app/device-runtime";
import { resolveTransportBadgeState } from "../../app/device-runtime-support";
import type { StoredDevice } from "../../domain/devices";
import { getLocalUsbDeviceLink } from "../../domain/localUsbLinks";
import { getWebSerialDeviceTransport } from "../../domain/webSerialLinks";
import { DeviceCard, type DeviceTransportBadge } from "../cards/DeviceCard";

const TRANSPORT_ORDER: DeviceTransportBadge["transport"][] = [
  "http",
  "web_serial",
  "local_usb",
];

export type DeviceListPanelProps = {
  devices: StoredDevice[];
  selectedDeviceId?: string;
  onSelect: (deviceId: string) => void;
};

export function DeviceListPanel({
  devices,
  selectedDeviceId,
  onSelect,
}: DeviceListPanelProps) {
  const { openAddDevice } = useAddDeviceUi();
  const { connectionState, transport, channelState, runtimeById } =
    useDeviceRuntime();

  const transportBadges = (deviceId: string): DeviceTransportBadge[] => {
    const current = transport(deviceId);
    const channels = runtimeById[deviceId]?.channels;
    const device = devices.find((candidate) => candidate.id === deviceId);
    if (!channels) {
      return [];
    }
    return TRANSPORT_ORDER.flatMap((candidate) => {
      const channel = channels[candidate];
      const hasHistory =
        candidate === "web_serial"
          ? Boolean(
              channel?.lastOkAt ||
                channel?.lastError ||
                device?.transports?.webSerialLabel,
            )
          : Boolean(channel?.lastOkAt || channel?.lastError);
      const linked =
        candidate === "http"
          ? Boolean(device?.transports?.httpBaseUrl || device?.baseUrl)
          : candidate === "local_usb"
            ? Boolean(
                getLocalUsbDeviceLink(deviceId) ??
                  device?.transports?.localUsbPortPath,
              )
            : Boolean(getWebSerialDeviceTransport(deviceId));
      const state = resolveTransportBadgeState({
        candidate,
        activeTransport: current,
        channelOnline: channelState(deviceId, candidate) === "online",
        linked,
        hasHistory,
      });
      if (!state) {
        return [];
      }
      return [{ transport: candidate, state }];
    });
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 py-6"
      data-testid="device-list"
    >
      <div className="ml-2 flex items-center justify-between">
        <h2 className="text-[16px] font-bold">Devices</h2>
        <button
          className="flex h-9 items-center justify-center rounded-[10px] bg-[var(--primary)] px-3 text-[12px] font-bold text-[var(--primary-text)]"
          type="button"
          onClick={openAddDevice}
        >
          + Add
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="mt-4 text-[12px] font-semibold text-[var(--muted)]">
          No devices yet.
        </div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-[14px] pr-1">
            {devices.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                selected={d.id === selectedDeviceId}
                status={connectionState(d.id)}
                transportBadges={transportBadges(d.id)}
                unselectedFill={selectedDeviceId ? "panel-2" : "panel"}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
