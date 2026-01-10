import { useMemo, useState } from "react";
import type { StoredDevice } from "../../domain/devices";
import { mockPortTelemetry } from "../../domain/mock";
import type { PortState } from "../../domain/ports";
import { PortCard } from "../cards/PortCard";
import { useToast } from "../toast/ToastProvider";

export function DeviceDashboardPanel({ device }: { device: StoredDevice }) {
  const { pushToast } = useToast();
  const [portA, setPortA] = useState<PortState>({
    power_enabled: true,
    replugging: false,
  });
  const [portC, setPortC] = useState<PortState>({
    power_enabled: true,
    replugging: false,
  });

  const telemetryA = useMemo(
    () => mockPortTelemetry(device.id, "port_a", portA.power_enabled),
    [device.id, portA.power_enabled],
  );
  const telemetryC = useMemo(
    () => mockPortTelemetry(device.id, "port_c", portC.power_enabled),
    [device.id, portC.power_enabled],
  );

  const replug = (
    label: string,
    setPort: (fn: (prev: PortState) => PortState) => void,
  ) => {
    setPort((prev) => ({ ...prev, replugging: true }));
    pushToast({
      message: `${device.name}: ${label} replug requested`,
      variant: "info",
    });

    window.setTimeout(() => {
      setPort((prev) => ({ ...prev, replugging: false }));
      pushToast({
        message: `${device.name}: ${label} replug done`,
        variant: "success",
      });
    }, 1200);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="device-dashboard">
      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">Device</div>
        <div className="mt-1 text-sm opacity-80">{device.name}</div>
        <div className="mt-1 font-mono text-xs opacity-70">
          {device.baseUrl}
        </div>
        <div className="mt-1 font-mono text-xs opacity-60">id: {device.id}</div>
        <div className="mt-3 text-xs opacity-70">
          Note: Mock UI only — no real device requests yet.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PortCard
          portId="port_a"
          label="USB-A"
          telemetry={telemetryA}
          state={portA}
          onTogglePower={() =>
            setPortA((prev) => ({
              ...prev,
              power_enabled: !prev.power_enabled,
            }))
          }
          onReplug={() => replug("USB-A", setPortA)}
        />
        <PortCard
          portId="port_c"
          label="USB-C"
          telemetry={telemetryC}
          state={portC}
          onTogglePower={() =>
            setPortC((prev) => ({
              ...prev,
              power_enabled: !prev.power_enabled,
            }))
          }
          onReplug={() => replug("USB-C", setPortC)}
        />
      </div>
    </div>
  );
}
