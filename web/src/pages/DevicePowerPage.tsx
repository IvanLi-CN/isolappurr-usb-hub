import { Link, useParams } from "react-router";

import { useDeviceRuntime } from "../app/device-runtime";
import { useDevices } from "../app/devices-store";
import { DevicePageTabs } from "../ui/nav/DevicePageTabs";
import { DevicePowerPanel } from "../ui/panels/DevicePowerPanel";

export function DevicePowerPage() {
  const { deviceId } = useParams();
  const { getDevice } = useDevices();
  const runtime = useDeviceRuntime();

  if (!deviceId) {
    return null;
  }

  const device = getDevice(deviceId);
  if (!device) {
    return (
      <div className="flex flex-col gap-3" data-testid="device-not-found">
        <div className="text-lg font-semibold">Device not found</div>
        <div className="text-sm opacity-80">
          Choose an existing device or add a new one.
        </div>
        <div>
          <Link className="link" to="/">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="device-power-page">
      <div>
        <div className="text-[24px] font-bold">{device.name}</div>
        <div className="mt-2 truncate font-mono text-[12px] font-semibold text-[var(--muted)]">
          power settings · {device.baseUrl}
        </div>
      </div>

      <DevicePageTabs deviceId={deviceId} />

      <DevicePowerPanel
        key={deviceId}
        deviceKey={deviceId}
        deviceName={device.name}
        clearIdleBiasCalibration={(owner) =>
          runtime.clearIdleBiasCalibration(deviceId, owner)
        }
        loadIdleBias={() => runtime.idleBias(deviceId)}
        loadPowerConfig={() => runtime.powerConfig(deviceId)}
        localAdvancedLocked={false}
        restorePowerDefaults={(owner) =>
          runtime.restorePowerDefaults(deviceId, owner)
        }
        runIdleBiasCalibration={(owner) =>
          runtime.runIdleBiasCalibration(deviceId, owner)
        }
        savePowerConfig={(input, owner) =>
          runtime.savePowerConfig(deviceId, input, owner)
        }
        setIdleBiasCorrection={(enabled, owner) =>
          runtime.setIdleBiasCorrection(deviceId, enabled, owner)
        }
        setPowerLock={(owner, acquire) =>
          runtime.setPowerLock(deviceId, owner, acquire)
        }
        transportLabel={runtime.transport(deviceId) ?? "unknown"}
      />
    </div>
  );
}
