import { createContext, useContext } from "react";
import type { DeviceRuntimeContextValue } from "./device-runtime-support";

export const DeviceRuntimeContext =
  createContext<DeviceRuntimeContextValue | null>(null);

export function useDeviceRuntime(): DeviceRuntimeContextValue {
  const ctx = useContext(DeviceRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useDeviceRuntime must be used within <DeviceRuntimeProvider>",
    );
  }
  return ctx;
}
