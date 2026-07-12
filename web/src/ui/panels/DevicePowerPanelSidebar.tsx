import type { PortState, PortTelemetry } from "../../domain/ports";
import { ActionButton } from "../actions/ActionButton";
import { formatTelemetryValue } from "../format/telemetry";
import {
  CableLoopCompensationCalculator,
  DiscreteSliderField,
  type FormState,
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

function TelemetryReading({
  available,
  dividerClass,
  isLast,
  toneClass,
  unit,
  value,
  testId,
}: {
  available: boolean;
  dividerClass: string;
  isLast?: boolean;
  toneClass: string;
  unit: "V" | "A" | "W";
  value: number | null;
  testId: string;
}) {
  const formatted = formatTelemetryValue(value, unit);

  return (
    <div
      className={`flex min-h-11 items-baseline justify-between gap-3 py-2 ${
        isLast
          ? ""
          : available
            ? dividerClass
            : "border-b border-[var(--border)]"
      }`}
      data-testid={testId}
    >
      <span
        className={`text-[12px] font-semibold ${
          available ? toneClass : "text-[var(--muted)]"
        }`}
      >
        {unit === "V" ? "Voltage" : unit === "A" ? "Current" : "Power"}
      </span>
      <span
        className={`whitespace-nowrap tabular-nums text-[1.125rem] font-medium leading-none sm:text-[1.25rem] ${
          available ? toneClass : "text-[var(--muted)]"
        }`}
      >
        {formatted.slice(0, -unit.length)}
        <span
          className={`ml-0.5 text-[0.65em] font-medium ${
            available ? toneClass : "text-[var(--muted)]"
          }`}
          data-testid={`${testId}-unit`}
        >
          {unit}
        </span>
      </span>
    </div>
  );
}

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
  const usbCVoltageAvailable = typeof usbCTelemetry?.voltage_mv === "number";
  const usbCCurrentAvailable = typeof usbCTelemetry?.current_ma === "number";
  const usbCPowerAvailable = typeof usbCTelemetry?.power_mw === "number";
  const usbCDataLinked =
    usbCState?.replugging === true
      ? "Replugging"
      : usbCState?.data_connected
        ? "Data linked"
        : "Data off";

  return (
    <aside className="grid gap-5">
      <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-4 py-4">
        <div className="border-b border-[var(--border)] pb-3">
          <div className="text-[14px] font-semibold">USB-C</div>
        </div>
        <div className="mt-3 grid h-7 grid-cols-2 gap-2">
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
        <div className="mt-4 grid gap-2">
          <TelemetryReading
            available={usbCVoltageAvailable}
            dividerClass="border-b border-[var(--telemetry-voltage-border)]"
            testId="usb-c-voltage"
            toneClass="text-[var(--telemetry-voltage)]"
            unit="V"
            value={usbCTelemetry?.voltage_mv ?? null}
          />
          <TelemetryReading
            available={usbCCurrentAvailable}
            dividerClass="border-b border-[var(--telemetry-current-border)]"
            testId="usb-c-current"
            toneClass="text-[var(--telemetry-current)]"
            unit="A"
            value={usbCTelemetry?.current_ma ?? null}
          />
          <TelemetryReading
            available={usbCPowerAvailable}
            dividerClass="border-b border-[var(--telemetry-power-border)]"
            isLast
            testId="usb-c-power"
            toneClass="text-[var(--telemetry-power)]"
            unit="W"
            value={usbCTelemetry?.power_mw ?? null}
          />
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
