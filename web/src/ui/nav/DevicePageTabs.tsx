import { NavLink } from "react-router";

export function DevicePageTabs({ deviceId }: { deviceId: string }) {
  const tabClass = ({ isActive }: { isActive: boolean }) =>
    ["tab", "tab-bordered", isActive ? "tab-active" : ""].join(" ");

  return (
    <div className="tabs tabs-lifted" role="tablist" data-testid="device-tabs">
      <NavLink className={tabClass} to={`/devices/${deviceId}`} role="tab" end>
        Dashboard
      </NavLink>
      <NavLink className={tabClass} to={`/devices/${deviceId}/info`} role="tab">
        Info
      </NavLink>
    </div>
  );
}
