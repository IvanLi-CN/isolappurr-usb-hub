import { useParams } from "react-router";

import { useDeviceRuntime } from "../app/device-runtime";
import { useDevices } from "../app/devices-store";
import { MissingDeviceState } from "../ui/errors/MissingDeviceState";
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
    return <MissingDeviceState />;
  }

  const deviceRuntime = runtime.runtimeById[deviceId];
  const usbCPort = runtime.port(deviceId, "port_c");

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
        coordination={runtime.coordination}
        canControlHardware={runtime.canControlHardware}
        powerLockOwner={runtime.powerLockOwner(deviceId)}
        requestControlTakeover={runtime.requestControlTakeover}
        clearIdleBiasCalibration={(owner) =>
          runtime.clearIdleBiasCalibration(deviceId, owner)
        }
        loadIdleBias={() => runtime.idleBias(deviceId)}
        loadPdDiagnostics={() => runtime.pdDiagnostics(deviceId)}
        loadPowerConfig={() => runtime.powerConfig(deviceId)}
        localAdvancedLocked={!runtime.canControlHardware}
        sharedIdleBiasSnapshot={deviceRuntime?.idleBias ?? null}
        sharedPdDiagnostics={deviceRuntime?.pdDiagnostics ?? null}
        sharedPowerConfig={deviceRuntime?.powerConfig ?? null}
        restorePowerDefaults={(owner) =>
          runtime.restorePowerDefaults(deviceId, owner)
        }
        runIdleBiasCalibration={(owner) =>
          runtime.runIdleBiasCalibration(deviceId, owner)
        }
        savePowerConfig={(input, owner) =>
          runtime.savePowerConfig(deviceId, input, owner)
        }
        replugUsbC={() => runtime.replug(deviceId, "port_c")}
        setPowerRuntime={(owner, action, enabled) =>
          runtime.setPowerRuntime(deviceId, owner, action, enabled)
        }
        setIdleBiasCorrection={(enabled, owner) =>
          runtime.setIdleBiasCorrection(deviceId, enabled, owner)
        }
        setPowerLock={(owner, acquire) =>
          runtime.setPowerLock(deviceId, owner, acquire)
        }
        transportLabel={runtime.transport(deviceId) ?? "unknown"}
        usbCPending={runtime.pending(deviceId, "port_c")}
        usbCState={usbCPort?.state ?? null}
        usbCTelemetry={usbCPort?.telemetry ?? null}
      />
    </div>
  );
}
