import { useState } from "react";
import type { DeviceTransport } from "../../app/device-runtime";
import type {
  Result,
  SettingsResetResponse,
  SettingsResetScope,
} from "../../domain/deviceApi";

export function DeviceSettingsResetPanel({
  transport,
  transportLabel,
  wifiCanManage,
  resetSettings,
  onWifiResetSuccess,
}: {
  transport: DeviceTransport | null;
  transportLabel: string;
  wifiCanManage: boolean;
  resetSettings: (
    scope: SettingsResetScope,
  ) => Promise<Result<SettingsResetResponse>>;
  onWifiResetSuccess: (rebootRequired: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<SettingsResetScope | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestReset = (scope: SettingsResetScope) => {
    if (scope === "wifi" && !wifiCanManage) {
      setError(
        "Connect with Web Serial or Local USB before resetting Wi-Fi settings.",
      );
      return;
    }
    if (scope === "other" && !transport) {
      setError("Connect this hub before resetting other settings.");
      return;
    }
    setError(null);
    setStatus(null);
    setConfirm(scope);
  };

  const confirmReset = async () => {
    if (!confirm) {
      return;
    }
    const scope = confirm;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await resetSettings(scope);
      if (res.ok) {
        if (scope === "wifi") {
          onWifiResetSuccess(Boolean(res.value.reboot_required));
        }
        setStatus(
          scope === "wifi"
            ? "Wi-Fi settings reset. Stored SSID and PSK were cleared."
            : "Other settings reset. Wi-Fi credentials were preserved.",
        );
        setConfirm(null);
        return;
      }
      setError(res.error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="iso-card rounded-[18px] bg-[var(--panel)] px-6 py-6 shadow-[inset_0_0_0_1px_var(--border)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[16px] font-bold leading-5">Reset settings</div>
          <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
            Reset Wi-Fi separately from USB-C mode and power settings.
          </div>
        </div>
        <div className="flex min-h-8 items-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-3 text-[12px] font-bold text-[var(--muted)]">
          Current: {transportLabel}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ResetSettingRow
          title="Wi-Fi"
          detail="Clear saved SSID and PSK. Requires Web Serial or Local USB."
          disabled={!wifiCanManage || busy}
          active={confirm === "wifi"}
          busy={busy && confirm === "wifi"}
          onRequest={() => requestReset("wifi")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmReset()}
        />
        <ResetSettingRow
          title="Other"
          detail="Clear USB-C mode and power settings while keeping Wi-Fi credentials."
          disabled={!transport || busy}
          active={confirm === "other"}
          busy={busy && confirm === "other"}
          onRequest={() => requestReset("other")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirmReset()}
        />
      </div>

      <div className="mt-4 text-[12px] font-semibold leading-5 text-[var(--muted)]">
        {wifiCanManage
          ? "Wi-Fi reset is available on the current USB-capable management path."
          : "Wi-Fi reset is disabled on Wi-Fi/LAN so this page cannot strand the current connection."}
      </div>

      {status ? (
        <div className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-[12px] font-semibold text-[var(--muted)]">
          {status}
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-[12px] border border-[var(--error)] bg-[var(--panel)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]"
          role="alert"
        >
          Settings reset failed: {error}
        </div>
      ) : null}
    </div>
  );
}

function ResetSettingRow({
  title,
  detail,
  disabled,
  active,
  busy,
  onRequest,
  onCancel,
  onConfirm,
}: {
  title: string;
  detail: string;
  disabled: boolean;
  active: boolean;
  busy: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
      <div className="flex min-h-10 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-5 text-[var(--text)]">
            {title}
          </div>
          <div className="mt-1 text-[12px] font-semibold leading-5 text-[var(--muted)]">
            {detail}
          </div>
        </div>
        {active ? (
          <div className="grid min-w-[188px] grid-cols-2 gap-2">
            <button
              className="btn btn-outline btn-sm min-h-10 justify-center"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm min-h-10 justify-center"
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Resetting..." : "Confirm"}
            </button>
          </div>
        ) : (
          <button
            className="btn btn-outline btn-sm min-h-10 min-w-[108px] justify-center"
            type="button"
            disabled={disabled}
            onClick={onRequest}
          >
            Reset
          </button>
        )}
      </div>
      {active ? (
        <div className="mt-3 rounded-[10px] border border-[var(--warning)] bg-[var(--panel)] px-3 py-2 text-[12px] font-semibold leading-5 text-[var(--warning)]">
          Confirm this reset for {title.toLowerCase()} settings.
        </div>
      ) : null}
    </div>
  );
}
