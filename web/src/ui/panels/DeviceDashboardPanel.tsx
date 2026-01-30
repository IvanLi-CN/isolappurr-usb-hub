import { useMemo } from "react";
import { useDeviceRuntime } from "../../app/device-runtime";
import type { StoredDevice } from "../../domain/devices";
import type { PortId, PortState, PortTelemetry } from "../../domain/ports";
import { PortCard } from "../cards/PortCard";
import { formatTimeHms } from "../format/time";

const fallbackTelemetry: PortTelemetry = {
  status: "error",
  voltage_mv: null,
  current_ma: null,
  power_mw: null,
  sample_uptime_ms: 0,
};

const fallbackState: PortState = {
  power_enabled: false,
  data_connected: false,
  replugging: false,
  busy: true,
};

function mergedPortState(
  state: PortState | undefined,
  pending: boolean,
): PortState {
  return {
    power_enabled: state?.power_enabled ?? false,
    data_connected: state?.data_connected ?? false,
    replugging: state?.replugging ?? false,
    busy: (state?.busy ?? true) || pending,
  };
}

function statusBadge(state: "online" | "offline" | "unknown"): {
  bg: string;
  text: string;
  width: string;
} {
  if (state === "online") {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[96px]",
    };
  }
  if (state === "offline") {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[96px]",
    };
  }
  return {
    bg: "bg-[var(--badge-warning-bg)]",
    text: "text-[var(--badge-warning-text)]",
    width: "w-[96px]",
  };
}

function upstreamBadge(upstreamConnected: boolean | null): {
  bg: string;
  text: string;
  width: string;
  label: string;
} {
  if (upstreamConnected === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[96px]",
      label: "HOST —",
    };
  }
  if (upstreamConnected) {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[96px]",
      label: "HOST LINK",
    };
  }
  return {
    bg: "bg-[var(--badge-error-bg)]",
    text: "text-[var(--badge-error-text)]",
    width: "w-[96px]",
    label: "NO HOST",
  };
}

export function DeviceDashboardPanel({ device }: { device: StoredDevice }) {
  const runtime = useDeviceRuntime();

  const connectionState = runtime.connectionState(device.id);
  const badge = statusBadge(connectionState);
  const upstream = upstreamBadge(
    connectionState === "online"
      ? (runtime.hub(device.id)?.upstream_connected ?? null)
      : null,
  );

  const lastOkAt = runtime.lastOkAt(device.id);
  const headerLastOk = lastOkAt === null ? "—" : formatTimeHms(lastOkAt);

  const rawBuildSha =
    (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "";
  const buildSha =
    rawBuildSha && rawBuildSha !== "dev" ? rawBuildSha.slice(0, 7) : "—";

  const notes = runtime.lastErrorLabel(device.id) ?? "—";

  const writeDisabled = connectionState !== "online";

  const items = useMemo(() => {
    const isOnline = connectionState === "online";

    const port = (portId: PortId) => runtime.port(device.id, portId);
    const pending = (portId: PortId) => runtime.pending(device.id, portId);

    const telemetry = (portId: PortId): PortTelemetry =>
      isOnline
        ? (port(portId)?.telemetry ?? fallbackTelemetry)
        : fallbackTelemetry;

    const state = (portId: PortId): PortState =>
      isOnline
        ? mergedPortState(port(portId)?.state ?? undefined, pending(portId))
        : fallbackState;

    return {
      port_a: {
        label: "USB-A",
        telemetry: telemetry("port_a"),
        state: state("port_a"),
      },
      port_c: {
        label: "USB-C",
        telemetry: telemetry("port_c"),
        state: state("port_c"),
      },
    };
  }, [connectionState, device.id, runtime]);

  return (
    <div className="flex flex-col gap-6" data-testid="device-dashboard">
      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)] sm:h-[104px]">
        <div className="grid grid-cols-1 gap-y-[10px] leading-4 sm:grid-cols-2 sm:gap-x-6">
          <div className="flex min-w-0 items-center">
            <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
              Status
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full",
                  badge.width,
                  badge.bg,
                  badge.text,
                  "text-[12px] font-semibold",
                ].join(" ")}
              >
                {connectionState.toUpperCase()}
              </div>
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full",
                  upstream.width,
                  upstream.bg,
                  upstream.text,
                  "text-[12px] font-semibold",
                ].join(" ")}
              >
                {upstream.label}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 items-center">
            <div className="w-12 text-[12px] font-semibold text-[var(--muted)]">
              Build
            </div>
            <div className="min-w-0 truncate font-mono text-[12px] font-semibold">
              {buildSha}
            </div>
          </div>
          <div className="flex items-center">
            <div className="w-[54px] text-[12px] font-semibold text-[var(--muted)]">
              Last ok
            </div>
            <div className="font-mono text-[12px] font-semibold">
              {headerLastOk}
            </div>
          </div>
          <div className="flex min-w-0 items-center">
            <div className="w-12 text-[12px] font-semibold text-[var(--muted)]">
              Notes
            </div>
            <div className="min-w-0 truncate text-[12px] font-semibold">
              {notes}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PortCard
          portId="port_a"
          label={items.port_a.label}
          telemetry={items.port_a.telemetry}
          state={items.port_a.state}
          disabled={writeDisabled}
          onTogglePower={() =>
            void runtime.setPower(
              device.id,
              "port_a",
              !items.port_a.state.power_enabled,
            )
          }
          onReplug={() => void runtime.replug(device.id, "port_a")}
        />
        <PortCard
          portId="port_c"
          label={items.port_c.label}
          telemetry={items.port_c.telemetry}
          state={items.port_c.state}
          disabled={writeDisabled}
          onTogglePower={() =>
            void runtime.setPower(
              device.id,
              "port_c",
              !items.port_c.state.power_enabled,
            )
          }
          onReplug={() => void runtime.replug(device.id, "port_c")}
        />
      </div>
    </div>
  );
}
