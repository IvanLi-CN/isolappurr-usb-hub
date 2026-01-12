import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type DeviceApiError,
  getPorts,
  replugPort,
  setPortPower,
} from "../domain/deviceApi";
import type { Port, PortId } from "../domain/ports";
import { useToast } from "../ui/toast/ToastProvider";
import { useDevices } from "./devices-store";

export type ConnectionState = "online" | "offline" | "unknown";

type DeviceRuntime = {
  lastOkAt: number | null;
  lastError: DeviceApiError | null;
  ports: Record<PortId, Port> | null;
  pending: Record<PortId, boolean>;
};

type DeviceRuntimeContextValue = {
  now: number;
  runtimeById: Record<string, DeviceRuntime>;
  connectionState: (deviceId: string) => ConnectionState;
  lastOkAt: (deviceId: string) => number | null;
  lastErrorLabel: (deviceId: string) => string | null;
  port: (deviceId: string, portId: PortId) => Port | null;
  pending: (deviceId: string, portId: PortId) => boolean;
  refreshDevice: (deviceId: string) => Promise<void>;
  setPower: (
    deviceId: string,
    portId: PortId,
    enabled: boolean,
  ) => Promise<void>;
  replug: (deviceId: string, portId: PortId) => Promise<void>;
};

const DeviceRuntimeContext = createContext<DeviceRuntimeContextValue | null>(
  null,
);

const OFFLINE_THRESHOLD_MS = 10_000;

function shortApiError(err: DeviceApiError): string {
  if (err.kind === "offline") {
    return "Offline: device unreachable";
  }
  if (err.kind === "preflight_blocked") {
    return "Blocked: CORS/PNA preflight";
  }
  if (err.kind === "invalid_response") {
    return "Invalid response";
  }
  if (err.kind === "busy") {
    return "Busy";
  }
  return `API error: ${err.code}`;
}

export function DeviceRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { devices } = useDevices();
  const { pushToast } = useToast();
  const [now, setNow] = useState(() => Date.now());
  const [runtimeById, setRuntimeById] = useState<Record<string, DeviceRuntime>>(
    {},
  );
  const inflight = useRef<Set<string>>(new Set());

  useEffect(() => {
    setRuntimeById((prev) => {
      const next: Record<string, DeviceRuntime> = { ...prev };
      const alive = new Set(devices.map((d) => d.id));
      for (const id of Object.keys(next)) {
        if (!alive.has(id)) {
          delete next[id];
        }
      }
      for (const d of devices) {
        if (!next[d.id]) {
          next[d.id] = {
            lastOkAt: null,
            lastError: null,
            ports: null,
            pending: { port_a: false, port_c: false },
          };
        }
      }
      return next;
    });
  }, [devices]);

  const pollDevice = useCallback(async (deviceId: string, baseUrl: string) => {
    if (inflight.current.has(deviceId)) {
      return;
    }
    inflight.current.add(deviceId);
    try {
      const res = await getPorts(baseUrl);
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        if (res.ok) {
          const portA = res.value.ports.find((p) => p.portId === "port_a");
          const portC = res.value.ports.find((p) => p.portId === "port_c");
          if (!portA || !portC) {
            return {
              ...prev,
              [deviceId]: {
                ...current,
                lastError: {
                  kind: "invalid_response",
                  message: "missing port_a or port_c in /api/v1/ports response",
                },
              },
            };
          }
          return {
            ...prev,
            [deviceId]: {
              ...current,
              lastOkAt: Date.now(),
              lastError: null,
              ports: { port_a: portA, port_c: portC },
            },
          };
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            lastError: res.error,
          },
        };
      });
    } finally {
      inflight.current.delete(deviceId);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (cancelled) {
        return;
      }
      await Promise.all(devices.map((d) => pollDevice(d.id, d.baseUrl)));
    };

    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [devices, pollDevice]);

  const setPending = useCallback(
    (deviceId: string, portId: PortId, value: boolean) => {
      setRuntimeById((prev) => {
        const current = prev[deviceId];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [deviceId]: {
            ...current,
            pending: { ...current.pending, [portId]: value },
          },
        };
      });
    },
    [],
  );

  const refreshDevice = useCallback(
    async (deviceId: string) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }
      await pollDevice(deviceId, device.baseUrl);
    },
    [devices, pollDevice],
  );

  const handleApiErrorToast = useCallback(
    (deviceName: string, label: string, err: DeviceApiError) => {
      if (err.kind === "busy") {
        pushToast({
          message: `${deviceName}: ${label} is busy`,
          variant: "warning",
        });
        return;
      }
      pushToast({
        message: `${deviceName}: ${label} error (${err.kind})`,
        variant: "error",
      });
    },
    [pushToast],
  );

  const setPower = useCallback(
    async (deviceId: string, portId: PortId, enabled: boolean) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }

      const label = portId === "port_a" ? "USB-A" : "USB-C";
      setPending(deviceId, portId, true);
      try {
        const res = await setPortPower(device.baseUrl, portId, enabled);
        if (res.ok) {
          pushToast({
            message: `${device.name}: ${label} power set`,
            variant: "success",
          });
          await refreshDevice(deviceId);
          return;
        }
        handleApiErrorToast(device.name, label, res.error);
      } finally {
        setPending(deviceId, portId, false);
      }
    },
    [devices, handleApiErrorToast, pushToast, refreshDevice, setPending],
  );

  const replug = useCallback(
    async (deviceId: string, portId: PortId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        return;
      }

      const label = portId === "port_a" ? "USB-A" : "USB-C";
      setPending(deviceId, portId, true);
      try {
        const res = await replugPort(device.baseUrl, portId);
        if (res.ok) {
          pushToast({
            message: `${device.name}: ${label} replug accepted`,
            variant: "success",
          });
          await refreshDevice(deviceId);
          return;
        }
        handleApiErrorToast(device.name, label, res.error);
      } finally {
        setPending(deviceId, portId, false);
      }
    },
    [devices, handleApiErrorToast, pushToast, refreshDevice, setPending],
  );

  const value = useMemo<DeviceRuntimeContextValue>(() => {
    const connectionState = (deviceId: string): ConnectionState => {
      const rt = runtimeById[deviceId];
      if (!rt || rt.lastOkAt === null) {
        return "unknown";
      }
      return now - rt.lastOkAt >= OFFLINE_THRESHOLD_MS ? "offline" : "online";
    };

    const lastOkAt = (deviceId: string): number | null =>
      runtimeById[deviceId]?.lastOkAt ?? null;

    const lastErrorLabel = (deviceId: string): string | null => {
      const rt = runtimeById[deviceId];
      if (!rt?.lastError) {
        return null;
      }
      return shortApiError(rt.lastError);
    };

    const port = (deviceId: string, portId: PortId): Port | null =>
      runtimeById[deviceId]?.ports?.[portId] ?? null;

    const pending = (deviceId: string, portId: PortId): boolean =>
      runtimeById[deviceId]?.pending?.[portId] ?? false;

    return {
      now,
      runtimeById,
      connectionState,
      lastOkAt,
      lastErrorLabel,
      port,
      pending,
      refreshDevice,
      setPower,
      replug,
    };
  }, [now, refreshDevice, replug, runtimeById, setPower]);

  return (
    <DeviceRuntimeContext.Provider value={value}>
      {children}
    </DeviceRuntimeContext.Provider>
  );
}

export function useDeviceRuntime(): DeviceRuntimeContextValue {
  const ctx = useContext(DeviceRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useDeviceRuntime must be used within <DeviceRuntimeProvider>",
    );
  }
  return ctx;
}
