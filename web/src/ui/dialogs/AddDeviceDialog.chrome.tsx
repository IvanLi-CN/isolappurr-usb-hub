import { ActionButton } from "../actions/ActionButton";

export type AddDeviceMethod = "wifi" | "web_serial" | "local_usb";

export function AddDeviceDialogHeader({
  onOpenFlash,
}: {
  onOpenFlash: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <div className="text-[24px] font-bold">Add device</div>
        <div className="mt-2 text-[14px] font-medium text-[var(--muted)]">
          Store locally; used for Dashboard and device pages.
        </div>
      </div>
      <ActionButton tone="secondary" onClick={onOpenFlash}>
        Open firmware flash
      </ActionButton>
    </div>
  );
}

export function AddDeviceDialogMethodTabs({
  method,
  demoEnabled,
  onSelect,
}: {
  method: AddDeviceMethod;
  demoEnabled: boolean;
  onSelect: (method: AddDeviceMethod) => void;
}) {
  const options: Array<{
    id: AddDeviceMethod;
    title: string;
    description: string;
  }> = [
    {
      id: "wifi",
      title: "Wi-Fi / LAN",
      description: "Discover or add a hub already reachable on the network.",
    },
    {
      id: "web_serial",
      title: "Web Serial",
      description: demoEnabled
        ? "Disabled in demo mode. Use discovery or manual add."
        : "Use the browser USB serial path to identify and add a hub.",
    },
    {
      id: "local_usb",
      title: "Local USB",
      description: demoEnabled
        ? "Disabled in demo mode. Use discovery or manual add."
        : "Use the desktop app for local USB identification.",
    },
  ];
  return (
    <div
      className="mt-6 grid grid-cols-1 gap-3 min-[760px]:grid-cols-3"
      role="tablist"
      aria-label="Connection method"
    >
      {options.map((option) => {
        const selected = method === option.id;
        return (
          <button
            key={option.id}
            className={[
              "min-h-[86px] rounded-[14px] border px-4 py-3 text-left transition-colors",
              selected
                ? "border-[var(--primary)] bg-[var(--panel)] shadow-[inset_0_0_0_1px_var(--primary)]"
                : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--primary)]",
            ].join(" ")}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={
              demoEnabled &&
              (option.id === "web_serial" || option.id === "local_usb")
            }
            onClick={() => onSelect(option.id)}
          >
            <div className="text-[14px] font-bold text-[var(--text)]">
              {option.title}
            </div>
            <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              {option.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function AddDeviceDialogFooter({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-6 flex items-center justify-end">
      <ActionButton tone="secondary" onClick={onCancel}>
        Cancel
      </ActionButton>
    </div>
  );
}
