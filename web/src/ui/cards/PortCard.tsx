import type { PortCardProps } from "./types";

function formatMv(value: number): string {
  return `${(value / 1000).toFixed(2)} V`;
}

function formatMa(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} A`;
  }
  return `${value} mA`;
}

function formatMw(value: number): string {
  return `${(value / 1000).toFixed(2)} W`;
}

export function PortCard({
  portId,
  label,
  telemetry,
  state,
  onTogglePower,
  onReplug,
}: PortCardProps) {
  return (
    <div
      className="card bg-base-100 shadow-sm"
      data-testid={`port-card-${portId}`}
    >
      <div className="card-body">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="card-title">{label}</h3>
            <div className="mt-1 text-xs opacity-70">Mock telemetry</div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="opacity-70">Power</span>
            <input
              className="toggle toggle-primary"
              type="checkbox"
              checked={state.power_enabled}
              disabled={state.replugging}
              onChange={onTogglePower}
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-box bg-base-200/60 p-3">
            <div className="text-xs opacity-70">Voltage</div>
            <div className="mt-1 font-mono text-sm">
              {formatMv(telemetry.voltage_mv)}
            </div>
          </div>
          <div className="rounded-box bg-base-200/60 p-3">
            <div className="text-xs opacity-70">Current</div>
            <div className="mt-1 font-mono text-sm">
              {formatMa(telemetry.current_ma)}
            </div>
          </div>
          <div className="rounded-box bg-base-200/60 p-3">
            <div className="text-xs opacity-70">Power</div>
            <div className="mt-1 font-mono text-sm">
              {formatMw(telemetry.power_mw)}
            </div>
          </div>
        </div>

        <div className="card-actions mt-4 justify-end">
          <button
            className={`btn btn-secondary btn-sm ${state.replugging ? "btn-disabled" : ""}`}
            type="button"
            disabled={state.replugging || !state.power_enabled}
            onClick={onReplug}
          >
            {state.replugging ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                Replugging
              </>
            ) : (
              "USB Replug"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
