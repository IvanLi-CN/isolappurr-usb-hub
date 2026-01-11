import { useMemo, useState } from "react";
import type { AddDeviceInput, StoredDevice } from "../../domain/devices";
import { DeviceCard } from "../cards/DeviceCard";
import { AddDeviceDialog } from "../dialogs/AddDeviceDialog";

export type DeviceListPanelProps = {
  devices: StoredDevice[];
  selectedDeviceId?: string;
  onSelect: (deviceId: string) => void;
  onRemove: (deviceId: string) => void;
  onAdd: (input: AddDeviceInput) => void;
};

export function DeviceListPanel({
  devices,
  selectedDeviceId,
  onSelect,
  onRemove,
  onAdd,
}: DeviceListPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<StoredDevice | null>(null);

  const existingIds = useMemo(() => devices.map((d) => d.id), [devices]);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="device-list">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Devices</h2>
        <button
          className="btn btn-sm btn-primary"
          type="button"
          onClick={() => setAddOpen(true)}
        >
          + Add
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="rounded-box bg-base-100 p-4 text-sm opacity-80">
          No devices yet. Add one to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              selected={d.id === selectedDeviceId}
              onSelect={onSelect}
              onRemove={() => setPendingRemove(d)}
            />
          ))}
        </div>
      )}

      <AddDeviceDialog
        open={addOpen}
        existingDeviceIds={existingIds}
        onClose={() => setAddOpen(false)}
        onCreate={onAdd}
      />

      <dialog className="modal" open={pendingRemove !== null}>
        <div className="modal-box">
          <h3 className="text-lg font-bold">Remove device?</h3>
          <p className="mt-2 text-sm opacity-80">
            This only removes the local configuration for{" "}
            <span className="font-semibold">{pendingRemove?.name}</span>.
          </p>
          <div className="modal-action">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setPendingRemove(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-error"
              type="button"
              onClick={() => {
                if (!pendingRemove) {
                  return;
                }
                onRemove(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit" onClick={() => setPendingRemove(null)}>
            close
          </button>
        </form>
      </dialog>
    </div>
  );
}
