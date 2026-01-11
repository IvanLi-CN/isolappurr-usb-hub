import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DeviceApiError,
  getPorts,
  replugPort,
  setPortPower,
} from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";
import { mockPortTelemetry } from "../../domain/mock";
import type {
  Port,
  PortId,
  PortState,
  PortTelemetry,
} from "../../domain/ports";
import { PortCard } from "../cards/PortCard";
import { useToast } from "../toast/ToastProvider";

export function DeviceDashboardPanel({ device }: { device: StoredDevice }) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<"real" | "mock">("real");
  const [ports, setPorts] = useState<Record<PortId, Port> | null>(null);
  const [lastError, setLastError] = useState<DeviceApiError | null>(null);
  const [pendingAction, setPendingAction] = useState<Record<PortId, boolean>>({
    port_a: false,
    port_c: false,
  });

  const fallbackTelemetry: PortTelemetry = useMemo(
    () => ({
      status: "error",
      voltage_mv: null,
      current_ma: null,
      power_mw: null,
      sample_uptime_ms: 0,
    }),
    [],
  );
  const fallbackState: PortState = useMemo(
    () => ({
      power_enabled: false,
      data_connected: false,
      replugging: false,
      busy: true,
    }),
    [],
  );
  const fallbackPorts: Record<PortId, Port> = useMemo(
    () => ({
      port_a: {
        portId: "port_a",
        label: "USB-A",
        telemetry: fallbackTelemetry,
        state: fallbackState,
        capabilities: { data_replug: true, power_set: true },
      },
      port_c: {
        portId: "port_c",
        label: "USB-C",
        telemetry: fallbackTelemetry,
        state: fallbackState,
        capabilities: { data_replug: true, power_set: true },
      },
    }),
    [fallbackState, fallbackTelemetry],
  );

  const pollPorts = useCallback(async () => {
    const res = await getPorts(device.baseUrl);
    if (res.ok) {
      const portA = res.value.ports.find((p) => p.portId === "port_a");
      const portC = res.value.ports.find((p) => p.portId === "port_c");
      if (!portA || !portC) {
        setPorts(fallbackPorts);
        setLastError({
          kind: "invalid_response",
          message: "missing port_a or port_c in /api/v1/ports response",
        });
        return;
      }

      setPorts({ port_a: portA, port_c: portC });
      setLastError(null);
      return;
    }

    setLastError(res.error);
  }, [device.baseUrl, fallbackPorts]);

  useEffect(() => {
    if (mode !== "real") {
      return;
    }
    let cancelled = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      await pollPorts();
    };

    void tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mode, pollPorts]);

  const mockPortA = useMemo(() => {
    const power_enabled = true;
    return {
      portId: "port_a",
      label: "USB-A",
      telemetry: mockPortTelemetry(device.id, "port_a", power_enabled),
      state: {
        power_enabled,
        data_connected: power_enabled,
        replugging: false,
        busy: false,
      },
      capabilities: { data_replug: true, power_set: true },
    } satisfies Port;
  }, [device.id]);

  const mockPortC = useMemo(() => {
    const power_enabled = true;
    return {
      portId: "port_c",
      label: "USB-C",
      telemetry: mockPortTelemetry(device.id, "port_c", power_enabled),
      state: {
        power_enabled,
        data_connected: power_enabled,
        replugging: false,
        busy: false,
      },
      capabilities: { data_replug: true, power_set: true },
    } satisfies Port;
  }, [device.id]);

  const portA = mode === "real" ? ports?.port_a : mockPortA;
  const portC = mode === "real" ? ports?.port_c : mockPortC;

  const mergedState = useCallback(
    (state: PortState | undefined, portId: PortId): PortState => ({
      power_enabled: state?.power_enabled ?? false,
      data_connected: state?.data_connected ?? false,
      replugging: state?.replugging ?? false,
      busy: (state?.busy ?? true) || pendingAction[portId],
    }),
    [pendingAction],
  );

  const mergedTelemetry = useCallback(
    (telemetry: PortTelemetry | undefined): PortTelemetry =>
      telemetry ?? fallbackTelemetry,
    [fallbackTelemetry],
  );

  const setPending = (portId: PortId, value: boolean) => {
    setPendingAction((prev) => ({ ...prev, [portId]: value }));
  };

  const handleApiErrorToast = (label: string, err: DeviceApiError) => {
    if (err.kind === "busy") {
      pushToast({
        message: `${device.name}: ${label} is busy`,
        variant: "warning",
      });
      return;
    }
    pushToast({
      message: `${device.name}: ${label} error (${err.kind})`,
      variant: "error",
    });
  };

  const handleReplug = async (portId: PortId, label: string) => {
    if (mode !== "real") {
      pushToast({
        message: `${device.name}: ${label} replug (mock)`,
        variant: "info",
      });
      return;
    }

    setPending(portId, true);
    try {
      const res = await replugPort(device.baseUrl, portId);
      if (res.ok) {
        pushToast({
          message: `${device.name}: ${label} replug accepted`,
          variant: "success",
        });
        await pollPorts();
        return;
      }
      handleApiErrorToast(label, res.error);
    } finally {
      setPending(portId, false);
    }
  };

  const handleTogglePower = async (
    portId: PortId,
    label: string,
    enabled: boolean,
  ) => {
    if (mode !== "real") {
      pushToast({
        message: `${device.name}: ${label} power toggle (mock)`,
        variant: "info",
      });
      return;
    }

    setPending(portId, true);
    try {
      const res = await setPortPower(device.baseUrl, portId, enabled);
      if (res.ok) {
        pushToast({
          message: `${device.name}: ${label} power set`,
          variant: "success",
        });
        await pollPorts();
        return;
      }
      handleApiErrorToast(label, res.error);
    } finally {
      setPending(portId, false);
    }
  };

  const statusLine = useMemo(() => {
    if (mode === "mock") {
      return "Mode: mock (no device requests)";
    }
    if (!lastError) {
      return "Mode: real (polling /api/v1/ports)";
    }
    if (lastError.kind === "preflight_blocked") {
      return "Blocked: CORS/PNA preflight (Chrome permission prompt)";
    }
    if (lastError.kind === "offline") {
      return "Offline: device unreachable";
    }
    return `Error: ${lastError.kind}`;
  }, [lastError, mode]);

  return (
    <div className="flex flex-col gap-4" data-testid="device-dashboard">
      <div className="rounded-box bg-base-200/60 p-4">
        <div className="text-sm font-semibold">Device</div>
        <div className="mt-1 text-sm opacity-80">{device.name}</div>
        <div className="mt-1 font-mono text-xs opacity-70">
          {device.baseUrl}
        </div>
        <div className="mt-1 font-mono text-xs opacity-60">id: {device.id}</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs opacity-70">{statusLine}</div>
          <div className="join">
            <button
              className={`btn btn-xs join-item ${mode === "real" ? "btn-active" : ""}`}
              type="button"
              onClick={() => setMode("real")}
            >
              Real
            </button>
            <button
              className={`btn btn-xs join-item ${mode === "mock" ? "btn-active" : ""}`}
              type="button"
              onClick={() => setMode("mock")}
            >
              Mock
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PortCard
          portId="port_a"
          label="USB-A"
          telemetry={mergedTelemetry(portA?.telemetry)}
          state={mergedState(portA?.state, "port_a")}
          onTogglePower={() =>
            void handleTogglePower(
              "port_a",
              "USB-A",
              !(portA?.state.power_enabled ?? false),
            )
          }
          onReplug={() => void handleReplug("port_a", "USB-A")}
        />
        <PortCard
          portId="port_c"
          label="USB-C"
          telemetry={mergedTelemetry(portC?.telemetry)}
          state={mergedState(portC?.state, "port_c")}
          onTogglePower={() =>
            void handleTogglePower(
              "port_c",
              "USB-C",
              !(portC?.state.power_enabled ?? false),
            )
          }
          onReplug={() => void handleReplug("port_c", "USB-C")}
        />
      </div>
    </div>
  );
}
