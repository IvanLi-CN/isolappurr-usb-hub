import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import type { ActiveProtocol, FormState } from "./DevicePowerPanelControls";
import {
  activeProtocolLabel,
  negotiationBadgeLabel,
  protocolCardState,
} from "./DevicePowerPanelControls";

type ProtocolKey = keyof FormState["capability"]["protocols"] | "pps";
type Choice = { label: string; value: string };

type ProtocolDefinition = {
  key: ProtocolKey;
  label: string;
  negotiation: "cc" | "dpdm";
};

type ProtocolGridProps = {
  activeProtocol: ActiveProtocol | null;
  disabled: boolean;
  form: FormState;
  onCurrentProfileChange: (
    key: keyof FormState["capability"]["current"],
    value: number | boolean,
  ) => void;
  onFastChargeChange: (
    key: keyof FormState["capability"]["fast_charge"],
    value: boolean,
  ) => void;
  onProtocolChange: (
    key: keyof FormState["capability"]["protocols"],
    value: boolean,
  ) => void;
  onPpsChange: (value: boolean) => void;
  onToggleFixedVoltage: (mv: number) => void;
};

const protocols: readonly ProtocolDefinition[] = [
  { key: "pd", label: "PD", negotiation: "cc" },
  { key: "pps", label: "PPS", negotiation: "cc" },
  { key: "qc20", label: "QC2", negotiation: "dpdm" },
  { key: "qc30", label: "QC3", negotiation: "dpdm" },
  { key: "fcp", label: "FCP", negotiation: "dpdm" },
  { key: "afc", label: "AFC", negotiation: "dpdm" },
  { key: "scp", label: "SCP", negotiation: "dpdm" },
  { key: "pe20", label: "PE2", negotiation: "dpdm" },
  { key: "bc12", label: "BC1.2", negotiation: "dpdm" },
  { key: "sfcp", label: "SFCP", negotiation: "dpdm" },
];

const pdoChoices: readonly Choice[] = [
  { label: "9V", value: "9000" },
  { label: "12V", value: "12000" },
  { label: "15V", value: "15000" },
  { label: "20V", value: "20000" },
];

const ppsCurrentChoices: readonly Choice[] = [
  { label: "3A", value: "3000" },
  { label: "5A", value: "5000" },
];

const fastCurrentChoices: readonly Choice[] = [
  { label: "2.25A", value: "2250" },
  { label: "3.25A", value: "3250" },
];

const scpCurrentChoices: readonly Choice[] = [
  { label: "2A", value: "2000" },
  { label: "4A", value: "4000" },
  { label: "5A", value: "5000" },
];

const typeCBroadcastChoices: readonly Choice[] = [
  { label: "500mA", value: "500" },
  { label: "1.5A", value: "1500" },
];

export function DevicePowerPanelProtocolGrid({
  activeProtocol,
  disabled,
  form,
  onCurrentProfileChange,
  onFastChargeChange,
  onProtocolChange,
  onPpsChange,
  onToggleFixedVoltage,
}: ProtocolGridProps) {
  return (
    <div className="protocol-grid-container">
      <div
        className="protocol-grid grid items-start gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        data-testid="protocol-grid"
      >
        {protocols.map((protocol) => {
          const checked =
            protocol.key === "pps"
              ? form.capability.pd.pps
              : form.capability.protocols[protocol.key];
          const active = activeProtocol === protocol.key;
          const toggle = () => {
            if (protocol.key === "pps") {
              onPpsChange(!checked);
              return;
            }
            onProtocolChange(protocol.key, !checked);
          };

          return (
            <ProtocolCard
              active={active}
              activeProtocol={activeProtocol}
              checked={checked}
              disabled={disabled}
              form={form}
              key={protocol.key}
              onCurrentProfileChange={onCurrentProfileChange}
              onFastChargeChange={onFastChargeChange}
              onToggleFixedVoltage={onToggleFixedVoltage}
              protocol={protocol}
              toggle={toggle}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProtocolCard({
  active,
  activeProtocol,
  checked,
  disabled,
  form,
  onCurrentProfileChange,
  onFastChargeChange,
  onToggleFixedVoltage,
  protocol,
  toggle,
}: {
  active: boolean;
  activeProtocol: ActiveProtocol | null;
  checked: boolean;
  disabled: boolean;
  form: FormState;
  onCurrentProfileChange: ProtocolGridProps["onCurrentProfileChange"];
  onFastChargeChange: ProtocolGridProps["onFastChargeChange"];
  onToggleFixedVoltage: ProtocolGridProps["onToggleFixedVoltage"];
  protocol: ProtocolDefinition;
  toggle: () => void;
}) {
  const state = protocolCardState({ active, checked });

  return (
    <article
      className={`protocol-card protocol-inline-card flex min-w-0 flex-col gap-2 rounded-[8px] border px-2.5 py-2 transition sm:gap-1 sm:px-2 sm:py-1.5 ${state.className} ${disabled ? "opacity-60" : ""}`}
      data-protocol={protocol.key}
      data-state={state.dataState}
    >
      <button
        aria-pressed={checked}
        className="protocol-card-toggle flex w-full min-w-0 items-center justify-between gap-2 text-left"
        disabled={disabled}
        onClick={toggle}
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
        <span
          className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.05em] sm:h-5 sm:px-2 sm:text-[9px] ${
            active
              ? "border border-[var(--protocol-live-border)] bg-[var(--protocol-live-bg)] text-[var(--protocol-live-text)]"
              : checked
                ? "border border-[var(--protocol-on-badge-border)] bg-[var(--protocol-on-badge-bg)] text-[var(--protocol-on-badge-text)]"
                : "bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"
          }`}
        >
          {active
            ? activeProtocolLabel(activeProtocol)
            : checked
              ? "On"
              : "Off"}
        </span>
      </button>
      <ProtocolOptions
        disabled={disabled}
        form={form}
        onCurrentProfileChange={onCurrentProfileChange}
        onFastChargeChange={onFastChargeChange}
        onToggleFixedVoltage={onToggleFixedVoltage}
        protocol={protocol}
      />
    </article>
  );
}

function ProtocolOptions({
  disabled,
  form,
  onCurrentProfileChange,
  onFastChargeChange,
  onToggleFixedVoltage,
  protocol,
}: {
  disabled: boolean;
  form: FormState;
  onCurrentProfileChange: ProtocolGridProps["onCurrentProfileChange"];
  onFastChargeChange: ProtocolGridProps["onFastChargeChange"];
  onToggleFixedVoltage: ProtocolGridProps["onToggleFixedVoltage"];
  protocol: ProtocolDefinition;
}) {
  if (protocol.key === "pd") {
    return (
      <MultiChipGroup
        disabled={disabled}
        label="Fixed PDO"
        onToggle={(value) => onToggleFixedVoltage(Number(value))}
        options={pdoChoices}
        selectedValues={form.capability.pd.fixed_voltages_mv.map(String)}
      />
    );
  }

  if (protocol.key === "pps") {
    return (
      <div className="protocol-inline-options-grid">
        <SlidingChoiceGroup
          disabled={disabled}
          label="PPS3 current"
          onChange={(value) =>
            onCurrentProfileChange("pps3_limit_ma", Number(value))
          }
          options={ppsCurrentChoices}
          value={String(form.capability.current.pps3_limit_ma)}
        />
        <ToggleField
          disabled={disabled}
          label="PPS 5A"
          onToggle={() =>
            onCurrentProfileChange(
              "pd_pps_5a",
              !form.capability.current.pd_pps_5a,
            )
          }
          pressed={form.capability.current.pd_pps_5a}
        />
      </div>
    );
  }

  if (protocol.key === "qc20" || protocol.key === "qc30") {
    const key = `${protocol.key}_20v_enabled` as
      | "qc20_20v_enabled"
      | "qc30_20v_enabled";
    return (
      <ToggleField
        disabled={disabled}
        label="20V profile"
        onToggle={() =>
          onFastChargeChange(key, !form.capability.fast_charge[key])
        }
        pressed={form.capability.fast_charge[key]}
      />
    );
  }

  if (
    protocol.key === "fcp" ||
    protocol.key === "afc" ||
    protocol.key === "sfcp"
  ) {
    return (
      <div className="protocol-inline-options-grid">
        <SlidingChoiceGroup
          disabled={disabled}
          label="Current"
          onChange={(value) =>
            onCurrentProfileChange("fcp_afc_sfcp_limit_ma", Number(value))
          }
          options={fastCurrentChoices}
          value={String(form.capability.current.fcp_afc_sfcp_limit_ma)}
        />
        <ToggleField
          disabled={disabled}
          label="12V profile"
          onToggle={() =>
            onFastChargeChange(
              "non_pd_12v_enabled",
              !form.capability.fast_charge.non_pd_12v_enabled,
            )
          }
          pressed={form.capability.fast_charge.non_pd_12v_enabled}
        />
      </div>
    );
  }

  if (protocol.key === "scp") {
    return (
      <SlidingChoiceGroup
        disabled={disabled}
        label="Current"
        onChange={(value) =>
          onCurrentProfileChange("scp_limit_ma", Number(value))
        }
        options={scpCurrentChoices}
        value={String(form.capability.current.scp_limit_ma)}
      />
    );
  }

  if (protocol.key === "pe20") {
    return (
      <ToggleField
        disabled={disabled}
        label="20V profile"
        onToggle={() =>
          onFastChargeChange(
            "pe20_20v_enabled",
            !form.capability.fast_charge.pe20_20v_enabled,
          )
        }
        pressed={form.capability.fast_charge.pe20_20v_enabled}
      />
    );
  }

  return (
    <SlidingChoiceGroup
      disabled={disabled}
      label="Type-C broadcast"
      onChange={(value) =>
        onCurrentProfileChange("type_c_broadcast_ma", Number(value))
      }
      options={typeCBroadcastChoices}
      value={String(form.capability.current.type_c_broadcast_ma)}
    />
  );
}

function SlidingChoiceGroup({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly Choice[];
  value: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Record<string, HTMLLabelElement | null>>({});
  const radioName = useId();
  const [indicator, setIndicator] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const updateIndicator = useCallback(() => {
    const selectedOption = optionRefs.current[value];
    if (!selectedOption) {
      return;
    }
    setIndicator({
      height: selectedOption.offsetHeight,
      left: selectedOption.offsetLeft,
      top: selectedOption.offsetTop,
      width: selectedOption.offsetWidth,
    });
  }, [value]);

  useLayoutEffect(() => {
    updateIndicator();
    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(group);
    return () => observer.disconnect();
  }, [updateIndicator]);

  return (
    <div className="protocol-inline-control">
      <div className="protocol-inline-control-label">{label}</div>
      <div
        aria-label={label}
        className="protocol-inline-choice-group"
        data-testid={`protocol-choice-group-${label.toLowerCase().replaceAll(" ", "-")}`}
        ref={groupRef}
        role="radiogroup"
        style={{
          gridTemplateColumns: `repeat(${options.length}, max-content)`,
        }}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className="protocol-inline-choice-indicator"
            style={{
              height: indicator.height,
              transform: `translate3d(${indicator.left}px, ${indicator.top}px, 0)`,
              width: indicator.width,
            }}
          />
        ) : null}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              className={`protocol-inline-choice ${selected ? "is-selected" : ""}`}
              data-selected={selected}
              data-value={option.value}
              key={option.value}
              ref={(node) => {
                optionRefs.current[option.value] = node;
              }}
            >
              <input
                checked={selected}
                className="protocol-inline-choice-input"
                disabled={disabled}
                name={radioName}
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ToggleField({
  disabled,
  label,
  onToggle,
  pressed,
}: {
  disabled: boolean;
  label: string;
  onToggle: () => void;
  pressed: boolean;
}) {
  return (
    <div className="protocol-inline-control">
      <div className="protocol-inline-control-label">{label}</div>
      <button
        aria-label={label}
        aria-pressed={pressed}
        className={`protocol-inline-toggle ${pressed ? "is-on" : ""}`}
        data-pressed={pressed}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        {pressed ? "On" : "Off"}
      </button>
    </div>
  );
}

function MultiChipGroup({
  disabled,
  label,
  onToggle,
  options,
  selectedValues,
}: {
  disabled: boolean;
  label: string;
  onToggle: (value: string) => void;
  options: readonly Choice[];
  selectedValues: readonly string[];
}) {
  return (
    <div className="protocol-inline-control">
      <div className="protocol-inline-control-label">{label}</div>
      <div className="protocol-inline-chip-list">
        {options.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <button
              aria-label={`${label} ${option.label}`}
              aria-pressed={selected}
              className={`protocol-inline-chip ${selected ? "is-selected" : ""}`}
              data-selected={selected}
              data-value={option.value}
              disabled={disabled}
              key={option.value}
              onClick={() => onToggle(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
