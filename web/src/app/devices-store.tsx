import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type {
  AddDeviceInput,
  AddDeviceValidationResult,
  StoredDevice,
} from "../domain/devices";
import {
  loadStoredDevices,
  saveStoredDevices,
  validateAddDeviceInput,
} from "../domain/devices";

type DevicesContextValue = {
  devices: StoredDevice[];
  addDevice: (input: AddDeviceInput) => AddDeviceValidationResult;
  removeDevice: (deviceId: string) => void;
  getDevice: (deviceId: string) => StoredDevice | undefined;
};

const DevicesContext = createContext<DevicesContextValue | null>(null);

export function DevicesProvider({
  children,
  initialDevices,
}: {
  children: React.ReactNode;
  initialDevices?: StoredDevice[];
}) {
  const [devices, setDevices] = useState<StoredDevice[]>(() =>
    initialDevices ? initialDevices : loadStoredDevices(),
  );

  useEffect(() => {
    saveStoredDevices(devices);
  }, [devices]);

  const value = useMemo<DevicesContextValue>(() => {
    const existingIds = new Set(devices.map((d) => d.id));
    const existingBaseUrls = new Set(devices.map((d) => d.baseUrl));

    return {
      devices,
      addDevice: (input) => {
        const result = validateAddDeviceInput(
          input,
          existingIds,
          existingBaseUrls,
        );
        if (!result.ok) {
          return result;
        }

        setDevices((prev) => [...prev, result.device]);
        return result;
      },
      removeDevice: (deviceId) => {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      },
      getDevice: (deviceId) => devices.find((d) => d.id === deviceId),
    };
  }, [devices]);

  return (
    <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
  );
}

export function useDevices(): DevicesContextValue {
  const ctx = useContext(DevicesContext);
  if (!ctx) {
    throw new Error("useDevices must be used within <DevicesProvider>");
  }
  return ctx;
}
