import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceRuntime } from "../../app/device-runtime";
import type { PdDiagnosticsResponse } from "../../domain/deviceApi";
import type { StoredDevice } from "../../domain/devices";
import type { PortId, PortState, PortTelemetry } from "../../domain/ports";
import { PortCard } from "../cards/PortCard";
import { formatTimeHms } from "../format/time";

const LIVE_REFRESH_MS = 1_000;

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
  border: string;
  text: string;
  width: string;
} {
  if (state === "online") {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      border: "border-[var(--badge-success-border)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[96px]",
    };
  }
  if (state === "offline") {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      border: "border-[var(--badge-error-border)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[96px]",
    };
  }
  return {
    bg: "bg-[var(--badge-warning-bg)]",
    border: "border-[var(--badge-warning-border)]",
    text: "text-[var(--badge-warning-text)]",
    width: "w-[96px]",
  };
}

function upstreamBadge(upstreamConnected: boolean | null): {
  bg: string;
  border: string;
  text: string;
  width: string;
  label: string;
} {
  if (upstreamConnected === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      border: "border-[var(--badge-warning-border)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[96px]",
      label: "HOST —",
    };
  }
  if (upstreamConnected) {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      border: "border-[var(--badge-success-border)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[96px]",
      label: "HOST LINK",
    };
  }
  return {
    bg: "bg-[var(--badge-error-bg)]",
    border: "border-[var(--badge-error-border)]",
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
  border: string;
  text: string;
  width: string;
  label: string;
} {
  if (value === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      border: "border-[var(--badge-warning-border)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[112px]",
      label: labels.unknown,
    };
  }
  if (value) {
    return {
      bg: "bg-[var(--badge-success-bg)]",
      border: "border-[var(--badge-success-border)]",
      text: "text-[var(--badge-success-text)]",
      width: "w-[112px]",
      label: labels.on,
    };
  }
  return {
    bg: "bg-[var(--badge-error-bg)]",
    border: "border-[var(--badge-error-border)]",
    text: "text-[var(--badge-error-text)]",
    width: "w-[112px]",
    label: labels.off,
  };
}

function isolatedFaultBadge(value: boolean | null): {
  bg: string;
  border: string;
  text: string;
  width: string;
  label: string;
} {
  if (value === null) {
    return {
      bg: "bg-[var(--badge-warning-bg)]",
      border: "border-[var(--badge-warning-border)]",
      text: "text-[var(--badge-warning-text)]",
      width: "w-[112px]",
      label: "ISO FAULT —",
    };
  }
  if (value) {
    return {
      bg: "bg-[var(--badge-error-bg)]",
      border: "border-[var(--badge-error-border)]",
      text: "text-[var(--badge-error-text)]",
      width: "w-[112px]",
      label: "ISO FAULT",
    };
  }
  return {
    bg: "bg-[var(--badge-success-bg)]",
    border: "border-[var(--badge-success-border)]",
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

function liveModeTone(
  kind: PdDiagnosticsResponse["display"]["mode"]["kind"],
): string {
  if (kind === "off") {
    return "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]";
  }
  return "border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] text-[var(--protocol-live-text)]";
}

function liveBadgeTone(
  kind: PdDiagnosticsResponse["display"]["badge"]["kind"],
): string {
  if (kind === "focus") {
    return "border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] text-[var(--protocol-live-text)]";
  }
  if (kind === "on" || kind === "voltage") {
    return "border-[var(--surface-success-ring)] bg-[var(--surface-success-bg)] text-[var(--badge-success-text)]";
  }
  if (kind === "off") {
    return "border-[var(--btn-disabled-fill-soft)] bg-[var(--panel)] text-[var(--muted)]";
  }
  return "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)]";
}

function formatOutputCurrentLimitBadge(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return `${(value / 1000).toFixed(2)} A`;
}

function formatTmpTemperatureBadge(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return `${Math.trunc(value / 10)}°C`;
}

function tmpTemperatureBadgeTone(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value >= 1000) {
    return "border-[var(--badge-error-border)] bg-[var(--badge-error-bg)] text-[var(--badge-error-text)]";
  }
  if (value >= 800) {
    return "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]";
  }
  return "border-[var(--surface-success-ring)] bg-[var(--surface-success-bg)] text-[var(--badge-success-text)]";
}

export function DeviceDashboardPanel({ device }: { device: StoredDevice }) {
  const runtime = useDeviceRuntime();
  const [pdDiagnostics, setPdDiagnostics] =
    useState<PdDiagnosticsResponse | null>(null);
  const loadPdDiagnosticsRef = useRef(runtime.pdDiagnostics);

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

  useEffect(() => {
    loadPdDiagnosticsRef.current = runtime.pdDiagnostics;
  }, [runtime.pdDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    if (connectionState !== "online") {
      setPdDiagnostics(null);
      return () => {
        cancelled = true;
      };
    }

    const refreshLiveState = async () => {
      const res = await loadPdDiagnosticsRef.current(device.id);
      if (cancelled) {
        return;
      }
      if (res.ok) {
        setPdDiagnostics(res.value);
      } else {
        setPdDiagnostics(null);
      }
    };

    void refreshLiveState();
    const id = window.setInterval(
      () => void refreshLiveState(),
      LIVE_REFRESH_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connectionState, device.id]);

  const writeDisabled =
    connectionState !== "online" ||
    runtime.runtimeById[device.id]?.command?.state === "queued" ||
    runtime.runtimeById[device.id]?.command?.state === "running";

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

  const liveDisplay = pdDiagnostics?.display ?? null;
  const outputCurrentLimitBadge = formatOutputCurrentLimitBadge(
    pdDiagnostics?.tps_setpoint?.iout_limit_ma,
  );
  const thermal = pdDiagnostics?.thermal ?? null;
  const tmpTemperatureBadge = formatTmpTemperatureBadge(
    thermal?.sensors?.tmp112.temperature_deci_c,
  );
  const tmpTemperatureTone = tmpTemperatureBadgeTone(
    thermal?.sensors?.tmp112.temperature_deci_c,
  );
  const hasResolvedUsbCPort =
    connectionState === "online"
      ? runtime.port(device.id, "port_c") !== null
      : false;
  const usbCHeaderBadges = liveDisplay
    ? [
        ...(tmpTemperatureBadge && tmpTemperatureTone
          ? [
              {
                label: tmpTemperatureBadge,
                toneClassName: tmpTemperatureTone,
                testId: "dashboard-usb-c-tmp-temperature",
              },
            ]
          : []),
        ...(outputCurrentLimitBadge
          ? [
              {
                label: outputCurrentLimitBadge,
                toneClassName:
                  "border-[var(--primary)]/20 bg-[var(--primary)]/12 text-[var(--primary)]",
                testId: "dashboard-usb-c-iout-limit",
              },
            ]
          : []),
        {
          label: liveDisplay.mode.label,
          toneClassName: liveModeTone(liveDisplay.mode.kind),
          testId: "dashboard-usb-c-live-mode",
        },
        {
          label: liveDisplay.badge.label,
          toneClassName: liveBadgeTone(liveDisplay.badge.kind),
          testId: "dashboard-usb-c-live-badge",
        },
      ]
    : [];

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
                  "flex h-[26px] items-center justify-center rounded-full border",
                  badge.width,
                  badge.bg,
                  badge.border,
                  badge.text,
                  "text-[12px] font-semibold",
                ].join(" ")}
              >
                {connectionState.toUpperCase()}
              </div>
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full border",
                  upstream.width,
                  upstream.bg,
                  upstream.border,
                  upstream.text,
                  "text-[12px] font-semibold",
                ].join(" ")}
              >
                {upstream.label}
              </div>
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full border",
                  isolatedFault.width,
                  isolatedFault.bg,
                  isolatedFault.border,
                  isolatedFault.text,
                  "text-[11px] font-semibold",
                ].join(" ")}
              >
                {isolatedFault.label}
              </div>
              <div
                className={[
                  "flex h-[26px] items-center justify-center rounded-full border",
                  isolatedReady.width,
                  isolatedReady.bg,
                  isolatedReady.border,
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
          headerBadges={usbCHeaderBadges}
          showStatusBadge={
            usbCHeaderBadges.length === 0 ||
            (hasResolvedUsbCPort && items.port_c.telemetry.status !== "ok")
          }
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
