import type { StoredDevice } from "../../domain/devices";

export type DeviceCardProps = {
  device: StoredDevice;
  selected?: boolean;
  onSelect: (deviceId: string) => void;
  onRemove: (deviceId: string) => void;
};

export function DeviceCard({
  device,
  selected,
  onSelect,
  onRemove,
}: DeviceCardProps) {
  return (
    <div
      data-testid={`device-card-${device.id}`}
      className={[
        "card card-compact bg-base-100 shadow-sm",
        selected ? "ring-2 ring-primary" : "",
      ].join(" ")}
    >
      <div className="card-body">
        <button
          className="text-left"
          type="button"
          onClick={() => onSelect(device.id)}
        >
          <div className="font-semibold">{device.name}</div>
          <div className="text-xs opacity-70">{device.baseUrl}</div>
          <div className="mt-1 text-xs opacity-60">id: {device.id}</div>
        </button>
        <div className="card-actions justify-end">
          <button
            className="btn btn-ghost btn-xs"
            type="button"
            onClick={() => onRemove(device.id)}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
