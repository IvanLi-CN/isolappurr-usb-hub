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

function isolatedBadge(
  value: boolean | null,
  labels: { unknown: string; on: string; off: string },
): {
  bg: string;
  text: string;
  width: string;
  label: string;
} {
  if (value === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[112px]",
      label: labels.unknown,
    };
  }
  if (value) {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[112px]",
      label: labels.on,
    };
  }
  return {
    bg: "bg-[var(--badge-error-bg)]",
    text: "text-[var(--badge-error-text)]",
    width: "w-[112px]",
    label: labels.off,
  };
}

function isolatedFaultBadge(value: boolean | null): {
  bg: string;
  text: string;
  width: string;
  label: string;
} {
  if (value === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[112px]",
      label: "ISO FAULT —",
    };
  }
  if (value) {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[112px]",
      label: "ISO FAULT",
    };
  }
  return {
    bg: "bg-[var(--badge-success-bg)]",
    text: "text-[var(--badge-success-text)]",
    width: "w-[112px]",
    label: "ISO OK",
  };
}

function transportLabel(transport: "http" | "local_usb" | "web_serial" | null) {
  if (transport === "http") {
    return "Wi-Fi / LAN";
  }
  if (transport === "web_serial") {
    return "Web Serial";
  }
  if (transport === "local_usb") {
    return "Local USB";
  }
  return "—";
}

function shortChannelState(state: "online" | "offline" | "unknown"): string {
  if (state === "online") {
    return "on";
  }
  if (state === "offline") {
    return "off";
  }
  return "—";
}

export function DeviceDashboardPanel({ device }: { device: StoredDevice }) {
  const runtime = useDeviceRuntime();

  const connectionState = runtime.connectionState(device.id);
  const badge = statusBadge(connectionState);
  const hub = connectionState === "online" ? runtime.hub(device.id) : null;
  const upstream = upstreamBadge(
    connectionState === "online" ? (hub?.upstream_connected ?? null) : null,
  );
  const isolatedFault = isolatedFaultBadge(
    connectionState === "online" ? (hub?.isolated_usb_fault ?? null) : null,
  );
  const isolatedReady = isolatedBadge(
    connectionState === "online" ? (hub?.isolated_usb_ready ?? null) : null,
    {
      unknown: "ISO READY —",
      on: "ISO READY",
      off: "ISO WAIT",
    },
  );

  const lastOkAt = runtime.lastOkAt(device.id);
  const headerLastOk = lastOkAt === null ? "—" : formatTimeHms(lastOkAt);

  const rawBuildSha =
    (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "";
  const buildSha =
    rawBuildSha && rawBuildSha !== "dev" ? rawBuildSha.slice(0, 7) : "—";

  const transport = runtime.transport(device.id);
  const wifiState = runtime.channelState(device.id, "http");
  const webSerialState = runtime.channelState(device.id, "web_serial");
  const localUsbState = runtime.channelState(device.id, "local_usb");
  const notes =
    runtime.lastErrorLabel(device.id) ??
    `Primary: ${transportLabel(transport)} · Wi-Fi ${shortChannelState(wifiState)} · Web Serial ${shortChannelState(webSerialState)} · Local USB ${shortChannelState(localUsbState)}`;

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
      <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)] sm:min-h-[116px]">
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
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full",
                  isolatedFault.width,
                  isolatedFault.bg,
                  isolatedFault.text,
                  "text-[11px] font-semibold",
                ].join(" ")}
              >
                {isolatedFault.label}
              </div>
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full",
                  isolatedReady.width,
                  isolatedReady.bg,
                  isolatedReady.text,
                  "text-[11px] font-semibold",
                ].join(" ")}
              >
                {isolatedReady.label}
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

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
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
