import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router";

import type { ActiveProtocol, FormState } from "./DevicePowerPanelControls";

// PROTOTYPE: Three variants of the power-page protocol options, switchable via
// ?demo=true&variant= on the existing device Power route.

export const protocolOptionsPrototypeVariants = ["a", "b", "c"] as const;

export type ProtocolOptionsPrototypeVariant =
  (typeof protocolOptionsPrototypeVariants)[number];

type ProtocolKey =
  | "pd"
  | "pps"
  | "qc20"
  | "qc30"
  | "fcp"
  | "afc"
  | "scp"
  | "pe20"
  | "bc12"
  | "sfcp";

type FastProtocol = "fcp" | "afc" | "sfcp";
type HighVoltageProtocol = "qc20" | "qc30" | "pe20";
type FastCurrent = "2250" | "3250";
type ScpCurrent = "2000" | "4000" | "5000";
type TypeCBroadcast = "500" | "1500";

type ProtocolDefinition = {
  key: ProtocolKey;
  label: string;
  negotiation: "CC" | "DPDM";
};

type PrototypeState = {
  enabled: Record<ProtocolKey, boolean>;
  fixedVoltages: number[];
  pps3Current: "3000" | "5000";
  ppsFiveAmp: boolean;
  highVoltage: Record<HighVoltageProtocol, boolean>;
  fastCurrent: FastCurrent;
  fast12V: boolean;
  scpCurrent: ScpCurrent;
  typeCBroadcast: TypeCBroadcast;
};

type SetPrototypeState = Dispatch<SetStateAction<PrototypeState>>;

type ProtocolOptionsPrototypeProps = {
  activeProtocol: ActiveProtocol | null;
  form: FormState;
  variant: ProtocolOptionsPrototypeVariant;
};

type ProtocolCardProps = {
  activeProtocol: ActiveProtocol | null;
  protocol: ProtocolDefinition;
  setState: SetPrototypeState;
  state: PrototypeState;
};

type Choice = {
  label: string;
  value: string;
};

const protocols: readonly ProtocolDefinition[] = [
  { key: "pd", label: "PD", negotiation: "CC" },
  { key: "pps", label: "PPS", negotiation: "CC" },
  { key: "qc20", label: "QC2", negotiation: "DPDM" },
  { key: "qc30", label: "QC3", negotiation: "DPDM" },
  { key: "fcp", label: "FCP", negotiation: "DPDM" },
  { key: "afc", label: "AFC", negotiation: "DPDM" },
  { key: "scp", label: "SCP", negotiation: "DPDM" },
  { key: "pe20", label: "PE2", negotiation: "DPDM" },
  { key: "bc12", label: "BC1.2", negotiation: "DPDM" },
  { key: "sfcp", label: "SFCP", negotiation: "DPDM" },
];

const ccProtocols = protocols.filter(
  (protocol) => protocol.negotiation === "CC",
);
const dpdmProtocols = protocols.filter(
  (protocol) => protocol.negotiation === "DPDM",
);

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

const variantNames: Record<ProtocolOptionsPrototypeVariant, string> = {
  a: "A - flat cards",
  b: "B - signal paths",
  c: "C - protocol matrix",
};

export function readProtocolOptionsPrototypeVariant(
  value: string | null,
): ProtocolOptionsPrototypeVariant | null {
  if (value === "a" || value === "b" || value === "c") {
    return value;
  }
  return null;
}

export function DevicePowerPanelProtocolOptionsPrototype({
  activeProtocol,
  form,
  variant,
}: ProtocolOptionsPrototypeProps) {
  const [state, setState] = useState(() => createPrototypeState(form));

  useEffect(() => {
    setState(createPrototypeState(form));
  }, [form]);

  return (
    <div
      className="protocol-prototype"
      data-testid="protocol-options-prototype"
    >
      <div className="protocol-prototype__notice">
        <span className="protocol-prototype__notice-title">Prototype</span>
        <span>Selections stay local to this preview.</span>
      </div>

      {variant === "a" ? (
        <VariantCardGrid
          activeProtocol={activeProtocol}
          setState={setState}
          state={state}
        />
      ) : null}
      {variant === "b" ? (
        <VariantSignalPaths
          activeProtocol={activeProtocol}
          setState={setState}
          state={state}
        />
      ) : null}
      {variant === "c" ? (
        <VariantProtocolMatrix
          activeProtocol={activeProtocol}
          setState={setState}
          state={state}
        />
      ) : null}

      <ProtocolOptionsPrototypeSwitcher variant={variant} />
    </div>
  );
}

function createPrototypeState(form: FormState): PrototypeState {
  return {
    enabled: {
      pd: form.capability.protocols.pd,
      pps: form.capability.pd.pps,
      qc20: form.capability.protocols.qc20,
      qc30: form.capability.protocols.qc30,
      fcp: form.capability.protocols.fcp,
      afc: form.capability.protocols.afc,
      scp: form.capability.protocols.scp,
      pe20: form.capability.protocols.pe20,
      bc12: form.capability.protocols.bc12,
      sfcp: form.capability.protocols.sfcp,
    },
    fixedVoltages: form.capability.pd.fixed_voltages_mv,
    pps3Current: String(form.capability.current.pps3_limit_ma) as
      | "3000"
      | "5000",
    ppsFiveAmp: form.capability.current.pd_pps_5a,
    highVoltage: {
      qc20: form.capability.fast_charge.qc20_20v_enabled,
      qc30: form.capability.fast_charge.qc30_20v_enabled,
      pe20: form.capability.fast_charge.pe20_20v_enabled,
    },
    fastCurrent: String(
      form.capability.current.fcp_afc_sfcp_limit_ma,
    ) as FastCurrent,
    fast12V: form.capability.fast_charge.non_pd_12v_enabled,
    scpCurrent: String(form.capability.current.scp_limit_ma) as ScpCurrent,
    typeCBroadcast: String(
      form.capability.current.type_c_broadcast_ma,
    ) as TypeCBroadcast,
  };
}

function VariantCardGrid({
  activeProtocol,
  setState,
  state,
}: Omit<ProtocolCardProps, "protocol">) {
  return (
    <div className="protocol-prototype__card-grid">
      {protocols.map((protocol) => (
        <ProtocolPrototypeCard
          activeProtocol={activeProtocol}
          key={protocol.key}
          protocol={protocol}
          setState={setState}
          state={state}
        />
      ))}
    </div>
  );
}

function VariantSignalPaths({
  activeProtocol,
  setState,
  state,
}: Omit<ProtocolCardProps, "protocol">) {
  return (
    <div className="protocol-prototype__paths">
      <ProtocolChannel
        activeProtocol={activeProtocol}
        description="USB-C configuration channel"
        protocols={ccProtocols}
        setState={setState}
        state={state}
        title="CC negotiation"
      />
      <ProtocolChannel
        activeProtocol={activeProtocol}
        description="Legacy D+/D- handshake channel"
        protocols={dpdmProtocols}
        setState={setState}
        state={state}
        title="DPDM negotiation"
      />
    </div>
  );
}

function VariantProtocolMatrix({
  activeProtocol,
  setState,
  state,
}: Omit<ProtocolCardProps, "protocol">) {
  return (
    <div className="protocol-prototype__matrix">
      <div className="protocol-prototype__matrix-head" aria-hidden="true">
        <span>Protocol</span>
        <span>Available profiles</span>
      </div>
      {protocols.map((protocol) => (
        <ProtocolPrototypeMatrixRow
          activeProtocol={activeProtocol}
          key={protocol.key}
          protocol={protocol}
          setState={setState}
          state={state}
        />
      ))}
    </div>
  );
}

function ProtocolChannel({
  activeProtocol,
  description,
  protocols: channelProtocols,
  setState,
  state,
  title,
}: {
  activeProtocol: ActiveProtocol | null;
  description: string;
  protocols: readonly ProtocolDefinition[];
  setState: SetPrototypeState;
  state: PrototypeState;
  title: string;
}) {
  return (
    <section className="protocol-prototype__channel">
      <div className="protocol-prototype__channel-header">
        <div className="text-[13px] font-semibold text-[var(--text)]">
          {title}
        </div>
        <div className="text-[11px] text-[var(--muted)]">{description}</div>
      </div>
      <div className="protocol-prototype__path-list">
        {channelProtocols.map((protocol) => (
          <ProtocolPrototypeCard
            activeProtocol={activeProtocol}
            key={protocol.key}
            protocol={protocol}
            setState={setState}
            state={state}
          />
        ))}
      </div>
    </section>
  );
}

function ProtocolPrototypeCard({
  activeProtocol,
  protocol,
  setState,
  state,
}: ProtocolCardProps) {
  const enabled = state.enabled[protocol.key];
  const active = activeProtocol === protocol.key;

  return (
    <article
      className={`protocol-prototype__card ${enabled ? "is-enabled" : ""} ${
        active ? "is-live" : ""
      }`}
      data-protocol={protocol.key}
    >
      <ProtocolPrototypeHeader
        active={active}
        enabled={enabled}
        protocol={protocol}
        setState={setState}
      />
      <ProtocolPrototypeOptions
        protocol={protocol}
        setState={setState}
        state={state}
      />
    </article>
  );
}

function ProtocolPrototypeMatrixRow({
  activeProtocol,
  protocol,
  setState,
  state,
}: ProtocolCardProps) {
  const enabled = state.enabled[protocol.key];
  const active = activeProtocol === protocol.key;

  return (
    <article
      className={`protocol-prototype__matrix-row ${enabled ? "is-enabled" : ""} ${
        active ? "is-live" : ""
      }`}
      data-protocol={protocol.key}
    >
      <ProtocolPrototypeHeader
        active={active}
        enabled={enabled}
        protocol={protocol}
        setState={setState}
      />
      <ProtocolPrototypeOptions
        protocol={protocol}
        setState={setState}
        state={state}
      />
    </article>
  );
}

function ProtocolPrototypeHeader({
  active,
  enabled,
  protocol,
  setState,
}: {
  active: boolean;
  enabled: boolean;
  protocol: ProtocolDefinition;
  setState: SetPrototypeState;
}) {
  return (
    <button
      aria-pressed={enabled}
      className="protocol-prototype__header"
      onClick={() => {
        setState((current) => ({
          ...current,
          enabled: {
            ...current.enabled,
            [protocol.key]: !current.enabled[protocol.key],
          },
        }));
      }}
      type="button"
    >
      <span className="protocol-prototype__identity">
        <span className="text-[13px] font-semibold text-[var(--text)]">
          {protocol.label}
        </span>
        <span className="protocol-prototype__negotiation">
          {protocol.negotiation}
        </span>
      </span>
      <span
        className={`protocol-prototype__status ${
          active ? "is-live" : enabled ? "is-on" : ""
        }`}
      >
        {active ? "Live" : enabled ? "On" : "Off"}
      </span>
    </button>
  );
}

function ProtocolPrototypeOptions({
  protocol,
  setState,
  state,
}: Omit<ProtocolCardProps, "activeProtocol">) {
  if (protocol.key === "pd") {
    return (
      <MultiChipGroup
        label="Fixed PDO"
        onToggle={(value) => {
          const voltage = Number(value);
          setState((current) => ({
            ...current,
            fixedVoltages: current.fixedVoltages.includes(voltage)
              ? current.fixedVoltages.filter((item) => item !== voltage)
              : [...current.fixedVoltages, voltage],
          }));
        }}
        options={pdoChoices}
        selectedValues={state.fixedVoltages.map(String)}
      />
    );
  }

  if (protocol.key === "pps") {
    return (
      <div className="protocol-prototype__options-grid">
        <SlidingChoiceGroup
          label="PPS3 current"
          onChange={(value) => {
            setState((current) => ({
              ...current,
              pps3Current: value as PrototypeState["pps3Current"],
            }));
          }}
          options={ppsCurrentChoices}
          value={state.pps3Current}
        />
        <ToggleField
          label="PPS 5A"
          onToggle={() => {
            setState((current) => ({
              ...current,
              ppsFiveAmp: !current.ppsFiveAmp,
            }));
          }}
          pressed={state.ppsFiveAmp}
        />
      </div>
    );
  }

  if (isHighVoltageProtocol(protocol.key)) {
    const highVoltageProtocol = protocol.key;

    return (
      <ToggleField
        label="20V profile"
        onToggle={() => {
          setState((current) => ({
            ...current,
            highVoltage: {
              ...current.highVoltage,
              [highVoltageProtocol]: !current.highVoltage[highVoltageProtocol],
            },
          }));
        }}
        pressed={state.highVoltage[protocol.key]}
      />
    );
  }

  if (isFastProtocol(protocol.key)) {
    return (
      <div className="protocol-prototype__options-grid">
        <SlidingChoiceGroup
          label="Current"
          onChange={(value) => {
            setState((current) => ({
              ...current,
              fastCurrent: value as FastCurrent,
            }));
          }}
          options={fastCurrentChoices}
          value={state.fastCurrent}
        />
        <ToggleField
          label="12V profile"
          onToggle={() => {
            setState((current) => ({
              ...current,
              fast12V: !current.fast12V,
            }));
          }}
          pressed={state.fast12V}
        />
      </div>
    );
  }

  if (protocol.key === "scp") {
    return (
      <SlidingChoiceGroup
        label="Current"
        onChange={(value) => {
          setState((current) => ({
            ...current,
            scpCurrent: value as ScpCurrent,
          }));
        }}
        options={scpCurrentChoices}
        value={state.scpCurrent}
      />
    );
  }

  return (
    <SlidingChoiceGroup
      label="Type-C broadcast"
      onChange={(value) => {
        setState((current) => ({
          ...current,
          typeCBroadcast: value as TypeCBroadcast,
        }));
      }}
      options={typeCBroadcastChoices}
      value={state.typeCBroadcast}
    />
  );
}

function SlidingChoiceGroup({
  label,
  onChange,
  options,
  value,
}: {
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
    <div className="protocol-prototype__control">
      <div className="protocol-prototype__control-label">{label}</div>
      <div
        aria-label={label}
        className="protocol-prototype__choice-group"
        ref={groupRef}
        role="radiogroup"
        style={{
          gridTemplateColumns: `repeat(${options.length}, max-content)`,
        }}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className="protocol-prototype__choice-indicator"
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
              className={`protocol-prototype__choice ${
                selected ? "is-selected" : ""
              }`}
              key={option.value}
              ref={(node) => {
                optionRefs.current[option.value] = node;
              }}
            >
              <input
                checked={selected}
                className="protocol-prototype__choice-input"
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
  label,
  onToggle,
  pressed,
}: {
  label: string;
  onToggle: () => void;
  pressed: boolean;
}) {
  return (
    <div className="protocol-prototype__control">
      <div className="protocol-prototype__control-label">{label}</div>
      <button
        aria-pressed={pressed}
        className={`protocol-prototype__toggle ${pressed ? "is-on" : ""}`}
        onClick={onToggle}
        type="button"
      >
        {pressed ? "On" : "Off"}
      </button>
    </div>
  );
}

function MultiChipGroup({
  label,
  onToggle,
  options,
  selectedValues,
}: {
  label: string;
  onToggle: (value: string) => void;
  options: readonly Choice[];
  selectedValues: readonly string[];
}) {
  return (
    <div className="protocol-prototype__control">
      <div className="protocol-prototype__control-label">{label}</div>
      <div className="protocol-prototype__chip-list">
        {options.map((option) => {
          const selected = selectedValues.includes(option.value);
          return (
            <button
              aria-pressed={selected}
              className={`protocol-prototype__chip ${selected ? "is-selected" : ""}`}
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

function ProtocolOptionsPrototypeSwitcher({
  variant,
}: {
  variant: ProtocolOptionsPrototypeVariant;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const setVariant = useCallback(
    (nextVariant: ProtocolOptionsPrototypeVariant) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("demo", "true");
      nextParams.set("variant", nextVariant);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const currentIndex = protocolOptionsPrototypeVariants.indexOf(variant);
  const previousVariant =
    protocolOptionsPrototypeVariants[
      (currentIndex - 1 + protocolOptionsPrototypeVariants.length) %
        protocolOptionsPrototypeVariants.length
    ];
  const nextVariant =
    protocolOptionsPrototypeVariants[
      (currentIndex + 1) % protocolOptionsPrototypeVariants.length
    ];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setVariant(previousVariant);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setVariant(nextVariant);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextVariant, previousVariant, setVariant]);

  return (
    <div className="protocol-prototype__switcher">
      <button
        aria-label="Previous prototype variant"
        className="protocol-prototype__switcher-button"
        onClick={() => setVariant(previousVariant)}
        type="button"
      >
        Prev
      </button>
      <span className="protocol-prototype__switcher-label">
        {variantNames[variant]}
      </span>
      <button
        aria-label="Next prototype variant"
        className="protocol-prototype__switcher-button"
        onClick={() => setVariant(nextVariant)}
        type="button"
      >
        Next
      </button>
    </div>
  );
}

function isFastProtocol(protocol: ProtocolKey): protocol is FastProtocol {
  return protocol === "fcp" || protocol === "afc" || protocol === "sfcp";
}

function isHighVoltageProtocol(
  protocol: ProtocolKey,
): protocol is HighVoltageProtocol {
  return protocol === "qc20" || protocol === "qc30" || protocol === "pe20";
}
