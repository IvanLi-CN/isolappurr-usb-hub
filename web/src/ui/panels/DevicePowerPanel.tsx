import { useCallback } from "react";

import { ActionButton } from "../actions/ActionButton";
import {
  activeProtocolLabel,
  badgeTone,
  boolLabel,
  CableLoopCompensationCalculator,
  CompactMultiSelectField,
  CompactOptionsRow,
  CompactSelectField,
  cableLoopResistanceMohmToTpsCdcRise,
  DiscreteSliderField,
  type FormState,
  formatCompactCurrent,
  formatCurrentInput,
  formatPowerInput,
  formatSw2303LineCompensation,
  formatVoltageInput,
  formatVoltageOption,
  InlineHelpPopover,
  negotiationBadgeLabel,
  parseCurrentInput,
  parsePowerInput,
  parseVoltageInput,
  protocolCardState,
  UnitSliderField,
} from "./DevicePowerPanelControls";
import { DevicePowerPanelIdleBiasSection } from "./DevicePowerPanelIdleBiasSection";
import { DevicePowerPanelSidebar } from "./DevicePowerPanelSidebar";
import {
  formatThermalTemperature,
  thermalAttentionMessage,
  thermalReasonLabel,
  thermalSensorStatusLabel,
  thermalSensorTone,
  thermalStateLabel,
  thermalStateTone,
} from "./devicePowerThermal";
import {
  type DevicePowerPanelProps,
  useDevicePowerPanelState,
} from "./useDevicePowerPanelState";

export function DevicePowerPanel(props: DevicePowerPanelProps) {
  const {
    acquireControl,
    activeProtocol,
    busy,
    config,
    error,
    fixedVoltageSummary,
    form,
    idleBiasRunning,
    idleBiasSnapshot,
    lockBusy,
    lockStatusLabel,
    lockStatusTone,
    lockedByOtherHost,
    manualHighVoltageWarning,
    outputModeSaveDisabled,
    owner,
    pdDiagnostics,
    powerControlsDisabled,
    restoreDefaults,
    restoreDisabled,
    restoringDefaults,
    runtimeDischargeEnabled,
    runtimeOutputEnabled,
    saveInFlight,
    setCurrentProfile,
    setFastChargeConfig,
    setIdleBiasBusy,
    setIdleBiasRunning,
    setLightLoadMode,
    setManualNumber,
    setManualTpsCdcRise,
    setPathMode,
    setPowerWatts,
    setPps,
    setProtocol,
    setSw2303LineCompensation,
    setTpsMode,
    showAcquireControl,
    submitOutputMode,
    toggleFixedVoltage,
    toggleRuntime,
  } = useDevicePowerPanelState(props);
  const {
    clearIdleBiasCalibration,
    deviceName,
    loadIdleBias,
    replugUsbC,
    runIdleBiasCalibration,
    setIdleBiasCorrection,
    transportLabel,
    usbCPending,
    usbCState,
    usbCTelemetry,
  } = props;

  const handleAcquireControl = useCallback(() => {
    void acquireControl();
  }, [acquireControl]);

  const handleSubmitOutputMode = useCallback(() => {
    void submitOutputMode();
  }, [submitOutputMode]);

  const handleRestoreDefaults = useCallback(() => {
    void restoreDefaults();
  }, [restoreDefaults]);

  const thermal = pdDiagnostics?.thermal ?? null;
  const thermalAttention = thermal
    ? thermalAttentionMessage(thermal.state)
    : null;

  if (!form && error) {
    return (
      <section className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-6 py-8">
        <div className="max-w-[420px] text-center">
          <div className="text-[14px] font-semibold text-[var(--badge-error-text)]">
            Power settings unavailable
          </div>
          <div className="mt-2 text-[13px] text-[var(--muted)]">{error}</div>
        </div>
      </section>
    );
  }

  if (!form) {
    return (
      <section className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-6 py-8">
        <div className="text-sm text-[var(--muted)]">
          Loading power settings...
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5"
      data-testid="device-power-panel"
    >
      <header className="flex flex-col gap-2 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold">USB-C / Power</div>
          <div className="mt-1 text-[13px] text-[var(--muted)]">
            {deviceName} · active transport {transportLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span
            className={`inline-flex h-7 items-center rounded-full px-3 font-semibold ${config?.persisted ? badgeTone(true) : badgeTone(false)}`}
          >
            {config?.persisted ? "EEPROM saved" : "Unsaved default"}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-full border px-3 font-semibold ${lockStatusTone}`}
          >
            {lockStatusLabel}
          </span>
          <span
            className={`inline-flex h-7 items-center rounded-full border px-3 font-semibold ${
              idleBiasRunning
                ? "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
                : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
            }`}
          >
            {idleBiasRunning ? "Calibration running" : "Calibration idle"}
          </span>
          {showAcquireControl ? (
            <ActionButton
              tone="primary"
              loading={lockBusy}
              disabled={lockBusy}
              onClick={handleAcquireControl}
              data-testid="device-power-acquire-control"
            >
              Acquire control
            </ActionButton>
          ) : null}
        </div>
      </header>

      <div className="grid gap-5">
        <section className="grid gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[14px] font-semibold">Safe profile</div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Source capability stays on SW2303. Changes save to EEPROM and
                apply immediately.
              </div>
            </div>
          </div>
          <UnitSliderField
            disabled={powerControlsDisabled}
            formatValue={formatPowerInput}
            label="Power cap"
            max={100}
            min={1}
            onChange={setPowerWatts}
            parseValue={parsePowerInput}
            step={1}
            value={form.capability.power_watts}
          />
          <div className="protocol-grid grid items-start gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {[
              {
                key: "pd",
                label: "PD",
                negotiation: "cc" as const,
                checked: form.capability.protocols.pd,
                toggle: () => setProtocol("pd", !form.capability.protocols.pd),
                active: activeProtocol === "pd",
              },
              {
                key: "pps",
                label: "PPS",
                negotiation: "cc" as const,
                checked: form.capability.pd.pps,
                toggle: () => setPps(!form.capability.pd.pps),
                active: activeProtocol === "pps",
              },
              {
                key: "qc20",
                label: "QC2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.qc20,
                toggle: () =>
                  setProtocol("qc20", !form.capability.protocols.qc20),
                active: activeProtocol === "qc20",
              },
              {
                key: "qc30",
                label: "QC3",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.qc30,
                toggle: () =>
                  setProtocol("qc30", !form.capability.protocols.qc30),
                active: activeProtocol === "qc30",
              },
              {
                key: "fcp",
                label: "FCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.fcp,
                toggle: () =>
                  setProtocol("fcp", !form.capability.protocols.fcp),
                active: activeProtocol === "fcp",
              },
              {
                key: "afc",
                label: "AFC",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.afc,
                toggle: () =>
                  setProtocol("afc", !form.capability.protocols.afc),
                active: activeProtocol === "afc",
              },
              {
                key: "scp",
                label: "SCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.scp,
                toggle: () =>
                  setProtocol("scp", !form.capability.protocols.scp),
                active: activeProtocol === "scp",
              },
              {
                key: "pe20",
                label: "PE2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.pe20,
                toggle: () =>
                  setProtocol("pe20", !form.capability.protocols.pe20),
                active: activeProtocol === "pe20",
              },
              {
                key: "bc12",
                label: "BC1.2",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.bc12,
                toggle: () =>
                  setProtocol("bc12", !form.capability.protocols.bc12),
                active: activeProtocol === "bc12",
              },
              {
                key: "sfcp",
                label: "SFCP",
                negotiation: "dpdm" as const,
                checked: form.capability.protocols.sfcp,
                toggle: () =>
                  setProtocol("sfcp", !form.capability.protocols.sfcp),
                active: activeProtocol === "sfcp",
              },
            ].map((protocol) => (
              <div
                className={`protocol-card flex flex-col gap-2 rounded-[8px] border px-2.5 py-2 transition sm:gap-1 sm:px-2 sm:py-1.5 ${
                  protocolCardState({
                    active: protocol.active,
                    checked: protocol.checked,
                  }).className
                } ${powerControlsDisabled ? "opacity-60" : ""}`}
                data-state={
                  protocolCardState({
                    active: protocol.active,
                    checked: protocol.checked,
                  }).dataState
                }
                key={protocol.key}
              >
                <button
                  className="protocol-card-toggle flex w-full min-w-0 items-center justify-between gap-2 text-left"
                  disabled={powerControlsDisabled}
                  onClick={protocol.toggle}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold sm:text-[13px]">
                      {protocol.label}
                    </span>
                    <span
                      className="protocol-negotiation-badge h-5 shrink-0 items-center rounded-full border border-current/15 bg-[var(--panel)] px-1.5 text-[9px] font-bold uppercase tracking-[0.03em]"
                      data-testid={`${protocol.label}-negotiation-badge`}
                    >
                      {negotiationBadgeLabel(protocol.negotiation)}
                    </span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.05em] sm:h-5 sm:px-2 sm:text-[9px] ${
                        protocol.active
                          ? "border border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] text-[var(--protocol-live-text)]"
                          : protocol.checked
                            ? "border border-[var(--protocol-on-badge-border)] bg-[var(--protocol-on-badge-bg)] text-[var(--protocol-on-badge-text)]"
                            : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
                      }`}
                    >
                      {protocol.active
                        ? activeProtocolLabel(activeProtocol)
                        : protocol.checked
                          ? "On"
                          : "Off"}
                    </span>
                  </div>
                </button>
                <CompactOptionsRow>
                  {protocol.key === "pd" ? (
                    <CompactMultiSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Fixed PDO"
                      onToggle={(value) => toggleFixedVoltage(Number(value))}
                      options={[9000, 12000, 15000, 20000].map((value) => ({
                        value: String(value),
                        label: formatVoltageOption(value),
                        selected:
                          form.capability.pd.fixed_voltages_mv.includes(value),
                      }))}
                      summary={fixedVoltageSummary}
                    />
                  ) : null}
                  {protocol.key === "pps" ? (
                    <>
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="PPS3 current"
                        onChange={(value) =>
                          setCurrentProfile("pps3_limit_ma", Number(value))
                        }
                        options={[
                          { label: "3A", value: "3000" },
                          { label: "5A", value: "5000" },
                        ]}
                        summary={`P3 ${formatCompactCurrent(form.capability.current.pps3_limit_ma)}`}
                        value={String(form.capability.current.pps3_limit_ma)}
                      />
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="PPS 5A"
                        onChange={(value) =>
                          setCurrentProfile("pd_pps_5a", value === "true")
                        }
                        options={[
                          { label: "Off", value: "false" },
                          { label: "On", value: "true" },
                        ]}
                        summary={`5A ${boolLabel(form.capability.current.pd_pps_5a)}`}
                        value={String(form.capability.current.pd_pps_5a)}
                      />
                    </>
                  ) : null}
                  {protocol.key === "qc20" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "qc20_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.qc20_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.qc20_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "qc30" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "qc30_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.qc30_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.qc30_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "fcp" ||
                  protocol.key === "afc" ||
                  protocol.key === "sfcp" ? (
                    <>
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="Current"
                        onChange={(value) =>
                          setCurrentProfile(
                            "fcp_afc_sfcp_limit_ma",
                            Number(value),
                          )
                        }
                        options={[
                          { label: "2.25A", value: "2250" },
                          { label: "3.25A", value: "3250" },
                        ]}
                        summary={formatCompactCurrent(
                          form.capability.current.fcp_afc_sfcp_limit_ma,
                        )}
                        value={String(
                          form.capability.current.fcp_afc_sfcp_limit_ma,
                        )}
                      />
                      <CompactSelectField
                        disabled={powerControlsDisabled}
                        menuTitle="12V profile"
                        onChange={(value) =>
                          setFastChargeConfig(
                            "non_pd_12v_enabled",
                            value === "true",
                          )
                        }
                        options={[
                          { label: "Off", value: "false" },
                          { label: "On", value: "true" },
                        ]}
                        summary={`12V ${boolLabel(form.capability.fast_charge.non_pd_12v_enabled)}`}
                        value={String(
                          form.capability.fast_charge.non_pd_12v_enabled,
                        )}
                      />
                    </>
                  ) : null}
                  {protocol.key === "scp" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Current"
                      onChange={(value) =>
                        setCurrentProfile("scp_limit_ma", Number(value))
                      }
                      options={[
                        { label: "2A", value: "2000" },
                        { label: "4A", value: "4000" },
                        { label: "5A", value: "5000" },
                      ]}
                      summary={formatCompactCurrent(
                        form.capability.current.scp_limit_ma,
                      )}
                      value={String(form.capability.current.scp_limit_ma)}
                    />
                  ) : null}
                  {protocol.key === "pe20" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="20V profile"
                      onChange={(value) =>
                        setFastChargeConfig(
                          "pe20_20v_enabled",
                          value === "true",
                        )
                      }
                      options={[
                        { label: "Off", value: "false" },
                        { label: "On", value: "true" },
                      ]}
                      summary={`20V ${boolLabel(form.capability.fast_charge.pe20_20v_enabled)}`}
                      value={String(
                        form.capability.fast_charge.pe20_20v_enabled,
                      )}
                    />
                  ) : null}
                  {protocol.key === "bc12" ? (
                    <CompactSelectField
                      disabled={powerControlsDisabled}
                      menuTitle="Type-C broadcast"
                      onChange={(value) =>
                        setCurrentProfile("type_c_broadcast_ma", Number(value))
                      }
                      options={[
                        { label: "500mA", value: "500" },
                        { label: "1.5A", value: "1500" },
                      ]}
                      summary={formatCurrentInput(
                        form.capability.current.type_c_broadcast_ma,
                      ).replace(" ", "")}
                      value={String(
                        form.capability.current.type_c_broadcast_ma,
                      )}
                    />
                  ) : null}
                </CompactOptionsRow>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <section className="grid gap-4 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-2)] px-4 py-4">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold">Output mode</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">
                  Manual TPS output is only for advanced bench work. USB-C path
                  policy stays explicit.
                </div>
              </div>
              <div className="inline-flex h-9 w-full rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-3)] p-1 sm:w-auto">
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${
                    form.tps_mode === "auto_follow"
                      ? "bg-[var(--primary)] text-[var(--primary-text)]"
                      : "text-[var(--muted)]"
                  } ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setTpsMode("auto_follow")}
                  type="button"
                >
                  Auto follow
                </button>
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${
                    form.tps_mode === "manual"
                      ? "bg-[var(--primary)] text-[var(--primary-text)]"
                      : "text-[var(--muted)]"
                  } ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setTpsMode("manual")}
                  type="button"
                >
                  Manual TPS
                </button>
              </div>
            </div>

            <div className="grid gap-4">
              <UnitSliderField
                disabled={powerControlsDisabled || form.tps_mode !== "manual"}
                formatValue={formatVoltageInput}
                label="Voltage"
                max={21000}
                min={3000}
                onChange={(value) => setManualNumber("voltage_mv", value)}
                parseValue={parseVoltageInput}
                step={20}
                value={form.manual.voltage_mv}
              />
              <UnitSliderField
                disabled={powerControlsDisabled || form.tps_mode !== "manual"}
                formatValue={formatCurrentInput}
                label="Current limit"
                max={6350}
                min={1000}
                onChange={(value) => setManualNumber("current_limit_ma", value)}
                parseValue={parseCurrentInput}
                step={50}
                value={form.manual.current_limit_ma}
              />
              <DiscreteSliderField
                disabled={powerControlsDisabled || form.tps_mode !== "manual"}
                label="Cable loop compensation"
                labelAccessory={
                  <InlineHelpPopover
                    lines={[
                      "Applies in Manual TPS. Enter the VBUS plus return-path resistance, not the resistance of one conductor.",
                      "Measure the voltage drop between the board output and the load while the load current is stable.",
                      "Auto follow uses its own saved cable loop compensation.",
                    ]}
                    title="Manual cable loop compensation"
                  >
                    <CableLoopCompensationCalculator
                      disabled={
                        powerControlsDisabled || form.tps_mode !== "manual"
                      }
                      label="Manual cable loop compensation"
                      maxMohm={140}
                      onRecommend={(resistanceMohm) =>
                        setManualTpsCdcRise(
                          cableLoopResistanceMohmToTpsCdcRise(resistanceMohm),
                        )
                      }
                      stepMohm={20}
                    />
                  </InlineHelpPopover>
                }
                onChange={(value) =>
                  setManualTpsCdcRise(
                    Number(value) as FormState["manual"]["tps_cdc_rise_mv"],
                  )
                }
                options={[
                  { label: "0mΩ", value: "0" },
                  { label: "20mΩ", value: "100" },
                  { label: "40mΩ", value: "200" },
                  { label: "60mΩ", value: "300" },
                  { label: "80mΩ", value: "400" },
                  { label: "100mΩ", value: "500" },
                  { label: "120mΩ", value: "600" },
                  { label: "140mΩ", value: "700" },
                ]}
                value={String(form.manual.tps_cdc_rise_mv)}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted)]">
                <span>USB-C path</span>
                <InlineHelpPopover
                  lines={[
                    "Default disconnects only while manual voltage exceeds the negotiated SW2303 request.",
                    "Disconnect forces the SW2303 VBUS path off.",
                    "Force keeps USB-C VBUS connected to TPS VOUT.",
                    "Manual voltage above 5 V can still run hot, prefer Auto follow for sustained high-voltage use.",
                  ]}
                  title="USB-C path"
                />
                {manualHighVoltageWarning ? (
                  <span className="rounded-full border border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--badge-warning-text)]">
                    High voltage
                  </span>
                ) : null}
              </div>
              <div className="grid gap-2 lg:grid-cols-3">
                {[
                  ["default", "Default", "Above request"],
                  ["disconnect", "Disconnect", "VBUS off"],
                  ["force", "Force", "VBUS on"],
                ].map(([value, label, detail]) => (
                  <button
                    key={value}
                    className={`flex min-h-[88px] flex-col items-start justify-between rounded-[8px] border px-3 py-3 text-left ${
                      form.manual.usb_c_path_mode === value
                        ? "border-[var(--primary)] bg-[var(--panel-3)]"
                        : "border-[var(--border-subtle)] bg-[var(--panel)]"
                    } ${
                      powerControlsDisabled || form.tps_mode !== "manual"
                        ? "opacity-60"
                        : ""
                    }`}
                    disabled={
                      powerControlsDisabled || form.tps_mode !== "manual"
                    }
                    onClick={() =>
                      setPathMode(
                        value as FormState["manual"]["usb_c_path_mode"],
                      )
                    }
                    type="button"
                  >
                    <span className="text-[13px] font-semibold">{label}</span>
                    <span className="text-[12px] leading-5 text-[var(--muted)]">
                      {detail}
                    </span>
                  </button>
                ))}
              </div>
              <div className="text-[12px] leading-5 text-[var(--muted)]">
                Saved auto-follow cable loop compensation:{" "}
                {formatSw2303LineCompensation(form.sw2303_line_compensation)}.
                Auto follow applies that value and forces manual TPS cable loop
                compensation off.
              </div>
              {form.tps_mode === "manual" ? (
                <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--panel-3)] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="text-[13px] font-semibold">
                        TPS discharge on output-off
                      </div>
                      <InlineHelpPopover
                        lines={[
                          "Advanced control for TPS55288 `DISCHG`.",
                          "Only affects the TPS output shutdown state, not SW2303 internal discharge behavior.",
                        ]}
                        title="TPS discharge"
                      />
                    </div>
                    <ActionButton
                      className={
                        runtimeOutputEnabled
                          ? "min-w-[104px]"
                          : "min-w-[104px] opacity-60"
                      }
                      data-testid="runtime-discharge-toggle"
                      size="sm"
                      tone={runtimeDischargeEnabled ? "primary" : "secondary"}
                      disabled={powerControlsDisabled}
                      onClick={() =>
                        void toggleRuntime(
                          "discharge",
                          !runtimeDischargeEnabled,
                        )
                      }
                    >
                      {runtimeDischargeEnabled ? "Enabled" : "Disabled"}
                    </ActionButton>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 border-t border-[var(--border)] pt-4">
              <div className="flex flex-wrap justify-end gap-3">
                <ActionButton
                  className="min-w-[176px]"
                  loading={saveInFlight}
                  tone="primary"
                  disabled={outputModeSaveDisabled}
                  onClick={handleSubmitOutputMode}
                >
                  Save and apply
                </ActionButton>
                <ActionButton
                  className="min-w-[176px]"
                  loading={restoringDefaults}
                  tone="warning"
                  disabled={restoreDisabled}
                  onClick={handleRestoreDefaults}
                >
                  Restore defaults
                </ActionButton>
              </div>
            </div>
          </section>

          <DevicePowerPanelSidebar
            lightLoadMode={form.light_load_mode}
            onSetSw2303LineCompensation={setSw2303LineCompensation}
            onReplugUsbC={replugUsbC}
            onSetLightLoadMode={setLightLoadMode}
            onToggleRuntime={toggleRuntime}
            powerControlsDisabled={powerControlsDisabled}
            runtimeOutputEnabled={runtimeOutputEnabled}
            sw2303LineCompensation={form.sw2303_line_compensation}
            usbCPending={usbCPending}
            usbCState={usbCState}
            usbCTelemetry={usbCTelemetry}
          />
        </div>

        <section className="grid gap-4 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--panel-2)] px-4 py-4">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[14px] font-semibold">
                Thermal diagnostics
              </div>
              <div className="mt-1 text-[12px] text-[var(--muted)]">
                Live `pd-diagnostics` refreshes every second and clamps the
                active power ceiling without rewriting saved config.
              </div>
            </div>
            {thermal ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-semibold ${thermalStateTone(
                    thermal.state,
                  )}`}
                  data-testid="thermal-state"
                >
                  {thermalStateLabel(thermal.state)}
                </span>
                <span className="inline-flex h-7 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] font-semibold text-[var(--muted)]">
                  {thermalReasonLabel(thermal.reason)}
                </span>
              </div>
            ) : null}
          </div>
          {thermal ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    key: "mcu",
                    label: "MCU",
                    temperature: thermal.sensors.mcu.temperature_deci_c,
                    status: thermal.sensors.mcu.status,
                  },
                  {
                    key: "tmp112",
                    label: "TMP112",
                    temperature: thermal.sensors.tmp112.temperature_deci_c,
                    status: thermal.sensors.tmp112.status,
                  },
                ].map((sensor) => (
                  <div
                    className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3"
                    key={sensor.key}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-[var(--muted)]">
                        {sensor.label}
                      </div>
                      <span
                        className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-semibold ${thermalSensorTone(
                          sensor.status,
                        )}`}
                      >
                        {thermalSensorStatusLabel(sensor.status)}
                      </span>
                    </div>
                    <div
                      className="mt-3 text-[1.25rem] font-semibold text-[var(--text)]"
                      data-testid={`thermal-${sensor.key}-temperature`}
                    >
                      {formatThermalTemperature(sensor.temperature)}
                    </div>
                  </div>
                ))}
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Hottest point
                  </div>
                  <div
                    className="mt-3 text-[1.25rem] font-semibold text-[var(--text)]"
                    data-testid="thermal-hottest"
                  >
                    {formatThermalTemperature(
                      thermal.hottest_temperature_deci_c,
                    )}
                  </div>
                </div>
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Effective cap
                  </div>
                  <div
                    className="mt-3 text-[1.25rem] font-semibold text-[var(--text)]"
                    data-testid="thermal-effective-cap"
                  >
                    {thermal.effective_power_watts} W
                  </div>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Protection reason
                  </div>
                  <div
                    className="mt-2 text-[13px] font-semibold text-[var(--text)]"
                    data-testid="thermal-reason"
                  >
                    {thermalReasonLabel(thermal.reason)}
                  </div>
                  {thermalAttention ? (
                    <div
                      className="mt-3 rounded-[8px] border border-[var(--border)] bg-[var(--panel-3)] px-3 py-2 text-[12px] leading-5 text-[var(--muted)]"
                      data-testid="thermal-attention"
                    >
                      {thermalAttention}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3 py-3">
                  <div className="text-[12px] font-semibold text-[var(--muted)]">
                    Thermal sample
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-[var(--text)]">
                    {thermal.sample_uptime_ms.toLocaleString()} ms uptime
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--muted)]">
                    Same 1 s cadence as the live USB-C power telemetry.
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-[var(--muted)]">
              Waiting for live thermal diagnostics...
            </div>
          )}
        </section>

        <DevicePowerPanelIdleBiasSection
          busy={busy}
          clearIdleBiasCalibration={(nextOwner) =>
            clearIdleBiasCalibration(nextOwner)
          }
          initialIdleBias={idleBiasSnapshot}
          loadIdleBias={loadIdleBias}
          lockedByOtherHost={lockedByOtherHost}
          onBusyChange={setIdleBiasBusy}
          onRunningChange={setIdleBiasRunning}
          owner={owner}
          runIdleBiasCalibration={(nextOwner) =>
            runIdleBiasCalibration(nextOwner)
          }
          setIdleBiasCorrection={(enabled, nextOwner) =>
            setIdleBiasCorrection(enabled, nextOwner)
          }
        />
      </div>
    </section>
  );
}
