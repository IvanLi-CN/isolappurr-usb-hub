import { DemoNavLink } from "../../app/demo-navigation";

export function DevicePageTabs({ deviceId }: { deviceId: string }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="tablist"
      data-testid="device-tabs"
    >
      <DemoNavLink
        className={({ isActive }) =>
          [
            "flex h-[38px] w-[132px] items-center justify-center rounded-[14px] border border-[var(--border)]",
            "text-[14px] font-medium",
            isActive
              ? "bg-[var(--panel)] text-[var(--text)]"
              : "bg-[var(--tab-inactive-bg)] text-[var(--muted)]",
          ].join(" ")
        }
        to={`/devices/${deviceId}`}
        role="tab"
        end
      >
        Overview
      </DemoNavLink>
      <DemoNavLink
        className={({ isActive }) =>
          [
            "flex h-[38px] w-[132px] items-center justify-center rounded-[14px] border border-[var(--border)]",
            "text-[14px] font-medium",
            isActive
              ? "bg-[var(--panel)] text-[var(--text)]"
              : "bg-[var(--tab-inactive-bg)] text-[var(--muted)]",
          ].join(" ")
        }
        to={`/devices/${deviceId}/info`}
        role="tab"
      >
        Settings
      </DemoNavLink>
      <DemoNavLink
        className={({ isActive }) =>
          [
            "flex h-[38px] w-[132px] items-center justify-center rounded-[14px] border border-[var(--border)]",
            "text-[14px] font-medium",
            isActive
              ? "bg-[var(--panel)] text-[var(--text)]"
              : "bg-[var(--tab-inactive-bg)] text-[var(--muted)]",
          ].join(" ")
        }
        to={`/devices/${deviceId}/power`}
        role="tab"
      >
        Power
      </DemoNavLink>
    </div>
  );
}
