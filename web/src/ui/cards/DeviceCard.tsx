import type { ConnectionState } from "../../app/device-runtime";
import type { StoredDevice } from "../../domain/devices";

function badgeStyles(state: ConnectionState): {
  bg: string;
  text: string;
  width: string;
} {
  if (state === "online") {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[96px]",
    };
  }
  if (state === "offline") {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[96px]",
    };
  }
  return {
    bg: "bg-[var(--badge-warning-bg)]",
    text: "text-[var(--badge-warning-text)]",
    width: "w-[96px]",
  };
}

export type DeviceCardProps = {
  device: StoredDevice;
  selected?: boolean;
  status: ConnectionState;
  unselectedFill: "panel" | "panel-2";
  onSelect: (deviceId: string) => void;
};

export function DeviceCard({
  device,
  selected,
  status,
  unselectedFill,
  onSelect,
}: DeviceCardProps) {
  const fill =
    selected || unselectedFill === "panel"
      ? "bg-[var(--panel)]"
      : "bg-[var(--panel-2)]";
  const badge = badgeStyles(status);

  return (
    <button
      data-testid={`device-card-${device.id}`}
      className={[
        "w-full rounded-[14px] border border-[var(--border)]",
        "px-5 py-4 text-left",
        fill,
        selected ? "iso-card" : "",
      ].join(" ")}
      type="button"
      onClick={() => onSelect(device.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-medium">{device.name}</div>
          <div className="mt-1 font-mono text-[12px] font-semibold text-[var(--muted)]">
            {device.baseUrl}
          </div>
        </div>
        <div
          className={[
            "flex h-[22px] items-center justify-center rounded-full",
            badge.width,
            badge.bg,
            badge.text,
            "text-[12px] font-semibold",
          ].join(" ")}
        >
          {status}
        </div>
      </div>
    </button>
  );
}
