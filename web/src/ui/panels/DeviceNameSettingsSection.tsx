import { useEffect, useRef, useState } from "react";
import type { DeviceTransport } from "../../app/device-runtime";
import type {
  DeviceInfoResponse,
  DeviceNameMutationResponse,
  Result,
} from "../../domain/deviceApi";
import {
  deviceNameBytes,
  normalizeDeviceDisplayName,
  validateDeviceDisplayName,
} from "../../domain/deviceName";
import { ActionButton } from "../actions/ActionButton";
import { ConfirmDialog } from "../actions/ConfirmDialog";

export function DeviceNameSettingsSection({
  deviceId,
  info,
  sharedRevision,
  transport,
  busy,
  reloadInfo,
  setName,
  clearName,
}: {
  deviceId: string;
  info: DeviceInfoResponse | null;
  sharedRevision: number;
  transport: DeviceTransport | null;
  busy: boolean;
  reloadInfo: () => Promise<Result<DeviceInfoResponse>>;
  setName: (name: string) => Promise<Result<DeviceNameMutationResponse>>;
  clearName: () => Promise<Result<DeviceNameMutationResponse>>;
}) {
  const supported = info?.capabilities?.device_name === true;
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const previousDeviceIdRef = useRef(deviceId);
  const draftDirtyRef = useRef(false);
  const draftRevisionRef = useRef(sharedRevision);
  const observedDisplayNameRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const deviceChanged = previousDeviceIdRef.current !== deviceId;
    const nextDisplayName =
      info && Object.hasOwn(info.device, "display_name")
        ? info.device.display_name
        : undefined;
    const infoChanged = observedDisplayNameRef.current !== nextDisplayName;
    observedDisplayNameRef.current = nextDisplayName;
    if (deviceChanged) {
      previousDeviceIdRef.current = deviceId;
      draftDirtyRef.current = false;
      draftRevisionRef.current = sharedRevision;
      setError(null);
      setStatus(null);
      setDraft(nextDisplayName ?? "");
      return;
    }
    if (!draftDirtyRef.current) {
      draftRevisionRef.current = sharedRevision;
      if (info && Object.hasOwn(info.device, "display_name")) {
        setDraft(info.device.display_name ?? "");
      }
      return;
    }
    if (infoChanged && sharedRevision > draftRevisionRef.current) {
      setError(null);
      setStatus(null);
      setConflict(true);
    }
  }, [deviceId, info, sharedRevision]);

  const validation = validateDeviceDisplayName(draft);
  const canSubmit =
    supported && !busy && !saving && !clearing && !conflict && !validation;
  const showValidation =
    supported && (draftDirtyRef.current || draft.length > 0);

  const reload = async () => {
    const result = await reloadInfo();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const nextDisplayName = Object.hasOwn(result.value.device, "display_name")
      ? (result.value.device.display_name ?? "")
      : "";
    observedDisplayNameRef.current = result.value.device.display_name;
    draftDirtyRef.current = false;
    draftRevisionRef.current = sharedRevision;
    setDraft(nextDisplayName);
    setConflict(false);
    setError(null);
    setStatus("Latest device name loaded.");
  };

  const save = async () => {
    const value = normalizeDeviceDisplayName(draft);
    const validationError = validateDeviceDisplayName(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await setName(value);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      draftDirtyRef.current = false;
      draftRevisionRef.current = sharedRevision;
      setConflict(false);
      setDraft(result.value.display_name ?? "");
      setStatus("Device name saved.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Device name could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    setError(null);
    setStatus(null);
    try {
      const result = await clearName();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      draftDirtyRef.current = false;
      draftRevisionRef.current = sharedRevision;
      setConflict(false);
      setDraft("");
      setStatus("Device name cleared. The hostname is now shown.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Device name could not be cleared.",
      );
    } finally {
      setClearing(false);
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <section
        className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]"
        aria-labelledby="device-name-heading"
        aria-busy={busy || saving || clearing}
        data-testid="device-name-settings"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              className="m-0 text-[16px] font-bold leading-5"
              id="device-name-heading"
            >
              Device name
            </h2>
            <p className="mt-2 mb-0 text-[12px] font-semibold leading-5 text-[var(--muted)]">
              Stored on this hub in EEPROM. It does not change device ID,
              hostname, or URL.
            </p>
          </div>
          <div className="text-[12px] font-semibold text-[var(--muted)]">
            {supported
              ? `Manage via ${transport ?? "active transport"}`
              : "Unsupported by this firmware"}
          </div>
        </div>
        {busy ? (
          <output
            className="mt-3 text-[12px] font-semibold text-[var(--muted)]"
            aria-live="polite"
            data-testid="device-name-busy-status"
          >
            Another device operation is in progress. Device name controls are
            temporarily unavailable.
          </output>
        ) : null}
        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="form-control min-w-0 flex-1">
            <span className="label px-0 pb-1 pt-0">
              <span className="label-text text-[12px] font-bold text-[var(--muted)]">
                Name
              </span>
            </span>
            <input
              className="input input-sm w-full"
              value={draft}
              maxLength={48}
              disabled={!supported || busy || saving || clearing}
              onChange={(event) => {
                draftDirtyRef.current = true;
                setDraft(event.target.value);
                setError(null);
                setStatus(null);
              }}
              aria-describedby="device-name-help device-name-error"
              data-testid="device-name-input"
            />
            <span
              className="mt-1 text-[12px] font-semibold text-[var(--muted)]"
              id="device-name-help"
            >
              {deviceNameBytes(draft)} / 48 UTF-8 bytes
            </span>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:w-[230px]">
            <ActionButton
              tone="primary"
              loading={saving}
              disabled={!canSubmit}
              onClick={() => void save()}
            >
              Save
            </ActionButton>
            <ActionButton
              tone="warning"
              loading={clearing}
              disabled={
                !supported ||
                busy ||
                saving ||
                clearing ||
                info?.device.display_name == null
              }
              onClick={() => setConfirmOpen(true)}
            >
              Clear
            </ActionButton>
          </div>
        </div>
        {status ? (
          <output className="mt-3 block rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold text-[var(--muted)]">
            {status}
          </output>
        ) : null}
        {conflict ? (
          <div
            className="mt-3 flex flex-col gap-3 rounded-[12px] border border-[var(--warning)] px-4 py-3 text-[12px] font-semibold text-[var(--warning)] sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <span>
              Device name changed in another tab. Load the latest value before
              saving this draft.
            </span>
            <ActionButton
              size="xs"
              tone="warning"
              onClick={() => void reload()}
            >
              Use latest
            </ActionButton>
          </div>
        ) : null}
        {error || (showValidation && validation) ? (
          <div
            className="mt-3 rounded-[12px] border border-[var(--error)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]"
            role="alert"
            id="device-name-error"
          >
            {error ?? validation}
          </div>
        ) : null}
      </section>
      <ConfirmDialog
        open={confirmOpen}
        busy={clearing}
        tone="warning"
        title="Clear device name?"
        description="The hub will keep its identity and start showing its stable hostname again."
        confirmLabel="Clear device name"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void clear()}
      />
    </>
  );
}
