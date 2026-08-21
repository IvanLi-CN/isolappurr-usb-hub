import { useParams, useSearchParams } from "react-router";

import { useDemoMode } from "../app/demo-mode";
import { useDeviceRuntime } from "../app/device-runtime";
import { useDevices } from "../app/devices-store";
import { toHoldActionResult } from "../ui/actions/TwoStageHoldButton";
import { MissingDeviceState } from "../ui/errors/MissingDeviceState";
import { DevicePageTabs } from "../ui/nav/DevicePageTabs";
import { DevicePowerPanel } from "../ui/panels/DevicePowerPanel";
import { readProtocolOptionsPrototypeVariant } from "../ui/panels/DevicePowerPanelProtocolOptionsPrototype";

export function DevicePowerPage() {
  const { deviceId } = useParams();
  const [searchParams] = useSearchParams();
  const { enabled: demoEnabled } = useDemoMode();
  const { getDevice } = useDevices();
  const runtime = useDeviceRuntime();
  const protocolOptionsPrototypeVariant =
    import.meta.env.DEV && demoEnabled
      ? readProtocolOptionsPrototypeVariant(searchParams.get("variant"))
      : null;

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
        <DevicePageTabs deviceId={deviceId} />
      </div>

      <DevicePowerPanel
        key={deviceId}
        protocolOptionsPrototypeVariant={protocolOptionsPrototypeVariant}
        deviceKey={deviceId}
        deviceName={device.name}
        coordination={runtime.coordination}
        canControlHardware={runtime.canControlHardware}
        powerLockOwner={runtime.powerLockOwner(deviceId)}
        clearIdleBiasCalibration={(owner) =>
          runtime.clearIdleBiasCalibration(deviceId, owner)
        }
        loadIdleBias={() => runtime.idleBias(deviceId)}
        loadPdDiagnostics={() => runtime.pdDiagnostics(deviceId)}
        loadPowerConfig={() => runtime.powerConfig(deviceId)}
        localAdvancedLocked={false}
        sharedCommand={deviceRuntime?.command ?? null}
        sharedIdleBiasSnapshot={deviceRuntime?.idleBias ?? null}
        sharedPdDiagnostics={deviceRuntime?.pdDiagnostics ?? null}
        sharedPowerConfig={deviceRuntime?.powerConfig ?? null}
        sharedRevision={deviceRuntime?.revision ?? 0}
        restorePowerDefaults={(owner) =>
          runtime.restorePowerDefaults(deviceId, owner)
        }
        runIdleBiasCalibration={(owner) =>
          runtime.runIdleBiasCalibration(deviceId, owner)
        }
        savePowerConfig={(input, owner) =>
          runtime.savePowerConfig(deviceId, input, owner)
        }
        setUsbCData={(connected) =>
          runtime
            .setData(deviceId, "port_c", connected)
            .then(toHoldActionResult)
        }
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
        usbCDataLinkAvailable={usbCPort?.capabilities?.data_set === true}
        usbCState={usbCPort?.state ?? null}
        usbCTelemetry={usbCPort?.telemetry ?? null}
      />
    </div>
  );
}
