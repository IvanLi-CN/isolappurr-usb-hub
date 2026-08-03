import { type ReactNode, useRef, useState } from "react";
import { useAddDeviceUi } from "../../app/add-device-ui";
import { useDeviceRuntime } from "../../app/device-runtime";
import { resolveTransportBadgeState } from "../../app/device-runtime-support";
import type { StoredDevice } from "../../domain/devices";
import { getLocalUsbDeviceLink } from "../../domain/localUsbLinks";
import { getWebSerialDeviceTransport } from "../../domain/webSerialLinks";
import { ActionButton } from "../actions/ActionButton";
import { DeviceCard, type DeviceTransportBadge } from "../cards/DeviceCard";
import { useToast } from "../toast/ToastProvider";

const TRANSPORT_ORDER: DeviceTransportBadge["transport"][] = [
  "http",
  "web_serial",
  "local_usb",
];

export type DeviceListPanelProps = {
  devices: StoredDevice[];
  selectedDeviceId?: string;
  onSelect: (deviceId: string) => void;
  forceEmptyState?: boolean;
  footer?: ReactNode;
  headerAccessory?: ReactNode;
  onBeforeAddDevice?: () => void;
};

export function DeviceListPanel({
  devices,
  selectedDeviceId,
  onSelect,
  forceEmptyState = false,
  footer,
  headerAccessory,
  onBeforeAddDevice,
}: DeviceListPanelProps) {
  const { openAddDevice } = useAddDeviceUi();
  const {
    connectionState,
    transport,
    channelState,
    hub,
    identify,
    runtimeById,
  } = useDeviceRuntime();
  const { pushToast } = useToast();
  const [identifyBusy, setIdentifyBusy] = useState<Set<string>>(
    () => new Set(),
  );
  const [identifying, setIdentifying] = useState<Set<string>>(() => new Set());
  const identifyTimeout = useRef(new Map<string, number>());

  const transportBadges = (deviceId: string): DeviceTransportBadge[] => {
    const current = transport(deviceId);
    const channels = runtimeById[deviceId]?.channels;
    const device = devices.find((candidate) => candidate.id === deviceId);
    if (!channels) {
      return [];
    }
    return TRANSPORT_ORDER.flatMap((candidate) => {
      const channel = channels[candidate];
      const hasHistory =
        candidate === "web_serial"
          ? Boolean(
              channel?.lastOkAt ||
                channel?.lastError ||
                device?.transports?.webSerialLabel,
            )
          : Boolean(channel?.lastOkAt || channel?.lastError);
      const linked =
        candidate === "http"
          ? Boolean(device?.transports?.httpBaseUrl || device?.baseUrl)
          : candidate === "local_usb"
            ? Boolean(
                getLocalUsbDeviceLink(deviceId) ??
                  device?.transports?.localUsbPortPath,
              )
            : Boolean(getWebSerialDeviceTransport(deviceId));
      const state = resolveTransportBadgeState({
        candidate,
        activeTransport: current,
        channelOnline: channelState(deviceId, candidate) === "online",
        linked,
        hasHistory,
      });
      if (!state) {
        return [];
      }
      return [{ transport: candidate, state }];
    });
  };

  const requestIdentify = async (deviceId: string) => {
    setIdentifyBusy((current) => new Set(current).add(deviceId));
    try {
      const result = await identify(deviceId);
      if (!result.ok) {
        pushToast({ message: result.error.message, variant: "error" });
        return;
      }
      const previousTimeout = identifyTimeout.current.get(deviceId);
      if (previousTimeout !== undefined) {
        window.clearTimeout(previousTimeout);
      }
      setIdentifying((current) => new Set(current).add(deviceId));
      identifyTimeout.current.set(
        deviceId,
        window.setTimeout(() => {
          setIdentifying((current) => {
            const next = new Set(current);
            next.delete(deviceId);
            return next;
          });
          identifyTimeout.current.delete(deviceId);
        }, result.value.duration_ms),
      );
    } catch (error) {
      pushToast({
        message:
          error instanceof Error ? error.message : "Locate request failed",
        variant: "error",
      });
    } finally {
      setIdentifyBusy((current) => {
        const next = new Set(current);
        next.delete(deviceId);
        return next;
      });
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col px-6 py-6"
      data-testid="device-list"
    >
      <div className="ml-2 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold">Devices</h2>
        <div className="flex items-center gap-2">
          {headerAccessory}
          <ActionButton
            size="sm"
            tone="primary"
            onClick={() => {
              onBeforeAddDevice?.();
              openAddDevice();
            }}
          >
            + Add
          </ActionButton>
        </div>
      </div>

      {forceEmptyState || devices.length === 0 ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="text-[12px] font-semibold text-[var(--muted)]">
            No devices yet.
          </div>
          {footer ? (
            <div className="mt-auto border-t border-[var(--border)] pt-4">
              {footer}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-[14px] pr-1">
              {devices.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  selected={d.id === selectedDeviceId}
                  status={connectionState(d.id)}
                  transportBadges={transportBadges(d.id)}
                  unselectedFill={selectedDeviceId ? "panel-2" : "panel"}
                  onSelect={onSelect}
                  identifyAvailable={
                    connectionState(d.id) === "online" &&
                    runtimeById[d.id]?.identityVerified === true &&
                    hub(d.id)?.capabilities?.identify === true
                  }
                  identifyBusy={identifyBusy.has(d.id)}
                  identifying={identifying.has(d.id)}
                  onIdentify={requestIdentify}
                />
              ))}
            </div>
          </div>
          {footer ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              {footer}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
