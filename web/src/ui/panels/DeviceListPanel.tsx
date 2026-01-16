import { useAddDeviceUi } from "../../app/add-device-ui";
import { useDeviceRuntime } from "../../app/device-runtime";
import type { StoredDevice } from "../../domain/devices";
import { DeviceCard } from "../cards/DeviceCard";

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
  const { connectionState } = useDeviceRuntime();

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
