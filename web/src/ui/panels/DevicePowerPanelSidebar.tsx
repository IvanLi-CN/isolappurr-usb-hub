import type { PortState, PortTelemetry } from "../../domain/ports";
import { ActionButton } from "../actions/ActionButton";
import {
  CableLoopCompensationCalculator,
  DiscreteSliderField,
  type FormState,
  formatTelemetryValue,
  InlineHelpPopover,
} from "./DevicePowerPanelControls";

type DevicePowerPanelSidebarProps = {
  lightLoadMode: FormState["light_load_mode"];
  onSetSw2303LineCompensation: (
    value: FormState["sw2303_line_compensation"],
  ) => void;
  onReplugUsbC: () => Promise<void>;
  onSetLightLoadMode: (mode: FormState["light_load_mode"]) => void;
  onToggleRuntime: (
    action: "output" | "discharge",
    enabled: boolean,
  ) => Promise<void>;
  powerControlsDisabled: boolean;
  runtimeOutputEnabled: boolean;
  sw2303LineCompensation: FormState["sw2303_line_compensation"];
  usbCPending: boolean;
  usbCState: PortState | null;
  usbCTelemetry: PortTelemetry | null;
};

export function DevicePowerPanelSidebar({
  lightLoadMode,
  onSetSw2303LineCompensation,
  onReplugUsbC,
  onSetLightLoadMode,
  onToggleRuntime,
  powerControlsDisabled,
  runtimeOutputEnabled,
  sw2303LineCompensation,
  usbCPending,
  usbCState,
  usbCTelemetry,
}: DevicePowerPanelSidebarProps) {
  const usbCPowerActionDisabled = powerControlsDisabled || usbCPending;
  const usbCPowerEnabled = runtimeOutputEnabled;
  const usbCDataLinked =
    usbCState?.replugging === true
      ? "Replugging"
      : usbCState?.data_connected
        ? "Data linked"
        : "Data off";

  return (
    <aside className="grid gap-5">
      <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div className="text-[14px] font-semibold">USB-C</div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex h-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] px-3 text-[12px] font-semibold text-[var(--muted)]">
              {formatTelemetryValue(usbCTelemetry?.current_ma ?? null, "A")}
            </div>
          </div>
        </div>
        <div className="mt-4 grid h-7 grid-cols-2 gap-2">
          <div
            className={`flex min-w-0 items-center justify-center rounded-[8px] px-2 text-[11px] font-bold ${
              usbCPowerEnabled
                ? "border border-[var(--protocol-enabled-ring)] bg-[var(--protocol-enabled-bg)] text-[var(--primary-2)]"
                : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
            }`}
          >
            <span className="truncate">
              {usbCPowerEnabled ? "Power on" : "Power off"}
            </span>
          </div>
          <div
            className={`flex min-w-0 items-center justify-center rounded-[8px] px-2 text-[11px] font-bold ${
              usbCState?.data_connected && usbCState?.replugging !== true
                ? "border border-[var(--protocol-enabled-ring)] bg-[var(--protocol-enabled-bg)] text-[var(--primary-2)]"
                : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
            }`}
          >
            <span className="truncate">{usbCDataLinked}</span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              Voltage
            </div>
            <div
              className="mt-2 font-mono text-[24px] font-bold"
              data-testid="usb-c-voltage"
            >
              {formatTelemetryValue(usbCTelemetry?.voltage_mv ?? null, "V")}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              Current
            </div>
            <div
              className="mt-2 font-mono text-[24px] font-bold"
              data-testid="usb-c-current"
            >
              {formatTelemetryValue(usbCTelemetry?.current_ma ?? null, "A")}
            </div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              Power
            </div>
            <div
              className="mt-2 font-mono text-[24px] font-bold"
              data-testid="usb-c-power"
            >
              {formatTelemetryValue(usbCTelemetry?.power_mw ?? null, "W")}
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <ActionButton
            className="sm:w-[132px]"
            data-testid="runtime-output-toggle"
            tone="primary"
            disabled={usbCPowerActionDisabled}
            onClick={() =>
              void onToggleRuntime("output", !runtimeOutputEnabled)
            }
          >
            Power
          </ActionButton>
          <ActionButton
            className="sm:w-[140px]"
            tone="secondary"
            disabled={usbCPowerActionDisabled}
            onClick={() => void onReplugUsbC()}
          >
            Replug
          </ActionButton>
        </div>
      </section>

      <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-4">
          <div className="text-[14px] font-semibold">TPS light-load mode</div>
          <InlineHelpPopover
            lines={[
              "PFM follows the board default.",
              "FPWM forces TPS55288 PWM at light load and is saved with the same power config.",
            ]}
            title="TPS light-load mode"
          />
        </div>
        <div className="mt-3 inline-flex h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--panel)] p-1">
          <button
            className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold ${
              lightLoadMode === "pfm"
                ? "bg-[var(--primary)] text-[var(--primary-text)]"
                : "text-[var(--muted)]"
            } ${powerControlsDisabled ? "opacity-60" : ""}`}
            disabled={powerControlsDisabled}
            onClick={() => onSetLightLoadMode("pfm")}
            type="button"
          >
            PFM
          </button>
          <button
            className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold ${
              lightLoadMode === "fpwm"
                ? "bg-[var(--primary)] text-[var(--primary-text)]"
                : "text-[var(--muted)]"
            } ${powerControlsDisabled ? "opacity-60" : ""}`}
            disabled={powerControlsDisabled}
            onClick={() => onSetLightLoadMode("fpwm")}
            type="button"
          >
            FPWM
          </button>
        </div>
      </section>

      <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-4">
          <div className="text-[14px] font-semibold">
            Auto-follow cable loop compensation
          </div>
          <InlineHelpPopover
            lines={[
              "Applies in Auto follow.",
              "Enter the VBUS plus return-path resistance, not the resistance of one conductor.",
              "Measure the voltage drop between the board output and the load while the load current is stable.",
              "Manual TPS saves this value for the next return to automatic tracking.",
            ]}
            title="Auto-follow cable loop compensation"
          >
            <CableLoopCompensationCalculator
              disabled={powerControlsDisabled}
              label="Auto-follow cable loop compensation"
              maxMohm={150}
              onRecommend={(resistanceMohm) =>
                onSetSw2303LineCompensation(
                  `${resistanceMohm}mohm` as FormState["sw2303_line_compensation"],
                )
              }
              stepMohm={50}
            />
          </InlineHelpPopover>
        </div>
        <div className="mt-3">
          <DiscreteSliderField
            disabled={powerControlsDisabled}
            hideLabel
            label="Auto-follow cable loop compensation"
            showValue={false}
            onChange={(value) =>
              onSetSw2303LineCompensation(
                value as FormState["sw2303_line_compensation"],
              )
            }
            options={[
              { label: "Off", value: "off" },
              { label: "0mΩ", value: "0mohm" },
              { label: "50mΩ", value: "50mohm" },
              { label: "100mΩ", value: "100mohm" },
              { label: "150mΩ", value: "150mohm" },
            ]}
            value={sw2303LineCompensation}
          />
        </div>
      </section>
    </aside>
  );
}
