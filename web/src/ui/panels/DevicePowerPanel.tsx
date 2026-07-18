import { useCallback, useEffect, useRef, useState } from "react";

import type { CrossTabRuntimeLeaseState } from "../../app/cross-tab-runtime";
import type { SharedRuntimeCommandState } from "../../app/device-runtime-support";
import { canResumePowerLock } from "../../app/device-runtime-support";
import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigManualInput,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";
import type { PortState, PortTelemetry } from "../../domain/ports";
import { ActionButton } from "../actions/ActionButton";
import { useToast } from "../toast/ToastProvider";
import {
  activeProtocolLabel,
  badgeTone,
  boolLabel,
  CableLoopCompensationCalculator,
  CompactMultiSelectField,
  CompactOptionsRow,
  CompactSelectField,
  cableLoopResistanceMohmToTpsCdcRise,
  cloneConfig,
  DiscreteSliderField,
  type FormState,
  formatCompactCurrent,
  formatCurrentInput,
  formatFixedVoltageSummary,
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
  applyOutputModeDraft,
  extractOutputModeDraft,
  mergeNonOutputModeFields,
  type OutputModeDraft,
  serializeOutputModeDraft,
} from "./devicePowerPanelOutputMode";
import {
  isOwnSharedSaveCommand,
  resolveNextSlowSaveDelayMs,
  resolveSlowSavePhase,
  resolveSlowSaveReferenceStartedAtMs,
  type SlowSavePhase,
} from "./devicePowerPanelSaveStatus";

type DevicePowerPanelProps = {
  deviceKey: string;
  deviceName: string;
  transportLabel: string;
  coordination: CrossTabRuntimeLeaseState;
  canControlHardware: boolean;
  powerLockOwner: number;
  localAdvancedLocked: boolean;
  sharedCommand: SharedRuntimeCommandState | null;
  sharedRevision: number;
  sharedPowerConfig: PowerConfigResponse | null;
  sharedIdleBiasSnapshot: IdleBiasResponse | null;
  sharedPdDiagnostics: PdDiagnosticsResponse | null;
  loadPowerConfig: () => Promise<Result<PowerConfigResponse>>;
  loadIdleBias: () => Promise<Result<IdleBiasResponse>>;
  savePowerConfig: (
    input: PowerConfigInput,
    owner: number,
  ) => Promise<Result<PowerConfigResponse>>;
  restorePowerDefaults: (owner: number) => Promise<Result<PowerConfigResponse>>;
  setPowerLock: (
    owner: number,
    acquire: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setPowerRuntime: (
    owner: number,
    action: "output" | "discharge",
    enabled: boolean,
  ) => Promise<Result<PowerConfigResponse>>;
  setIdleBiasCorrection: (
    enabled: boolean,
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  runIdleBiasCalibration: (owner: number) => Promise<Result<IdleBiasResponse>>;
  clearIdleBiasCalibration: (
    owner: number,
  ) => Promise<Result<IdleBiasResponse>>;
  loadPdDiagnostics: () => Promise<Result<PdDiagnosticsResponse>>;
  usbCTelemetry: PortTelemetry | null;
  usbCState: PortState | null;
  usbCPending: boolean;
  replugUsbC: () => Promise<void>;
};

const AUTO_APPLY_DELAY_MS = 400;

function serializeAutoApplyForm(form: FormState): string {
  return JSON.stringify(form);
}

export function DevicePowerPanel({
  deviceKey,
  deviceName,
  transportLabel,
  coordination,
  canControlHardware,
  powerLockOwner,
  localAdvancedLocked,
  sharedCommand,
  sharedRevision,
  sharedPowerConfig,
  sharedIdleBiasSnapshot,
  sharedPdDiagnostics,
  loadPowerConfig,
  loadIdleBias,
  savePowerConfig,
  restorePowerDefaults,
  setPowerLock,
  setPowerRuntime,
  setIdleBiasCorrection,
  runIdleBiasCalibration,
  clearIdleBiasCalibration,
  loadPdDiagnostics,
  usbCTelemetry,
  usbCState,
  usbCPending,
  replugUsbC,
}: DevicePowerPanelProps) {
  const { pushToast } = useToast();
  const [config, setConfig] = useState<PowerConfigResponse | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autoApplyFailed, setAutoApplyFailed] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [slowSavePhase, setSlowSavePhase] = useState<SlowSavePhase>("idle");
  const [outputModeDraft, setOutputModeDraft] =
    useState<OutputModeDraft | null>(null);
  const [outputModeConflict, setOutputModeConflict] = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const [freshConfigLoaded, setFreshConfigLoaded] = useState(false);
  const [controlAcquisitionFailed, setControlAcquisitionFailed] =
    useState(false);
  const [idleBiasSnapshot, setIdleBiasSnapshot] =
    useState<IdleBiasResponse | null>(null);
  const [pdDiagnostics, setPdDiagnostics] =
    useState<PdDiagnosticsResponse | null>(null);
  const [idleBiasBusy, setIdleBiasBusy] = useState(false);
  const [idleBiasRunning, setIdleBiasRunning] = useState(false);
  const lockedRef = useRef(false);
  const autoAcquireAttemptKeyRef = useRef<string | null>(null);
  const lockRequestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const loadPowerConfigRef = useRef(loadPowerConfig);
  const loadIdleBiasRef = useRef(loadIdleBias);
  const loadPdDiagnosticsRef = useRef(loadPdDiagnostics);
  const setPowerLockRef = useRef(setPowerLock);
  const setPowerRuntimeRef = useRef(setPowerRuntime);
  const ownerRef = useRef(powerLockOwner);
  const formRef = useRef<FormState | null>(null);
  const dirtyRef = useRef(false);
  const saveStartedAtRef = useRef<number | null>(null);
  const slowLockToastShownRef = useRef(false);
  const blockingCommandToastKeyRef = useRef<string | null>(null);
  const outputModeDraftRef = useRef<OutputModeDraft | null>(null);
  const outputModeBaselineSignatureRef = useRef<string | null>(null);
  const outputModeConflictToastKeyRef = useRef<string | null>(null);

  const initializeLoadedConfig = useCallback(
    (nextConfig: PowerConfigResponse) => {
      const nextForm = cloneConfig(nextConfig);
      const nextOutputModeSignature = serializeOutputModeDraft(
        extractOutputModeDraft(nextForm),
      );
      setConfig(nextConfig);
      setForm((current) => {
        let syncedForm =
          dirtyRef.current && current
            ? mergeNonOutputModeFields(nextForm, current)
            : nextForm;
        if (outputModeDraftRef.current) {
          syncedForm = applyOutputModeDraft(
            syncedForm,
            outputModeDraftRef.current,
          );
        }
        return syncedForm;
      });
      if (outputModeDraftRef.current) {
        if (
          outputModeBaselineSignatureRef.current !== null &&
          nextOutputModeSignature !== outputModeBaselineSignatureRef.current
        ) {
          setOutputModeConflict(true);
        }
      } else {
        outputModeBaselineSignatureRef.current = nextOutputModeSignature;
        setOutputModeConflict(false);
      }
      setError(null);
    },
    [],
  );

  useEffect(() => {
    loadPowerConfigRef.current = loadPowerConfig;
  }, [loadPowerConfig]);

  useEffect(() => {
    loadIdleBiasRef.current = loadIdleBias;
  }, [loadIdleBias]);

  useEffect(() => {
    loadPdDiagnosticsRef.current = loadPdDiagnostics;
  }, [loadPdDiagnostics]);

  useEffect(() => {
    setPowerLockRef.current = setPowerLock;
  }, [setPowerLock]);

  useEffect(() => {
    setPowerRuntimeRef.current = setPowerRuntime;
  }, [setPowerRuntime]);

  useEffect(() => {
    ownerRef.current = powerLockOwner;
  }, [powerLockOwner]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    outputModeDraftRef.current = outputModeDraft;
  }, [outputModeDraft]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sharedPowerConfig) {
      return;
    }
    initializeLoadedConfig(sharedPowerConfig);
  }, [initializeLoadedConfig, sharedPowerConfig]);

  useEffect(() => {
    if (!sharedIdleBiasSnapshot) {
      return;
    }
    setIdleBiasSnapshot(sharedIdleBiasSnapshot);
    setIdleBiasRunning(sharedIdleBiasSnapshot.run.state === "running");
  }, [sharedIdleBiasSnapshot]);

  useEffect(() => {
    if (!sharedPdDiagnostics) {
      return;
    }
    setPdDiagnostics(sharedPdDiagnostics);
  }, [sharedPdDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      const configRes = await loadPowerConfigRef.current();
      if (cancelled) {
        return;
      }
      if (configRes.ok) {
        setFreshConfigLoaded(true);
        initializeLoadedConfig(configRes.value);
      } else {
        setError(configRes.error.message);
      }
    };
    const loadIdleBiasSnapshot = async () => {
      const idleBiasRes = await loadIdleBiasRef.current();
      if (cancelled) {
        return;
      }
      if (idleBiasRes.ok) {
        setIdleBiasSnapshot(idleBiasRes.value);
        setIdleBiasRunning(idleBiasRes.value.run.state === "running");
      } else {
        setIdleBiasSnapshot(null);
        setIdleBiasRunning(false);
      }
    };
    const loadPdSnapshot = async () => {
      const pdRes = await loadPdDiagnosticsRef.current();
      if (cancelled) {
        return;
      }
      if (pdRes.ok) {
        setPdDiagnostics(pdRes.value);
      } else {
        setPdDiagnostics(null);
      }
    };
    void loadConfig();
    void loadIdleBiasSnapshot();
    void loadPdSnapshot();
    return () => {
      cancelled = true;
    };
  }, [initializeLoadedConfig]);

  useEffect(() => {
    if (form || transportLabel === "unknown") {
      return;
    }
    let cancelled = false;
    const retry = async () => {
      const configRes = await loadPowerConfigRef.current();
      if (cancelled || !configRes.ok) {
        return;
      }
      setFreshConfigLoaded(true);
      initializeLoadedConfig(configRes.value);
    };
    void retry();
    return () => {
      cancelled = true;
    };
  }, [form, initializeLoadedConfig, transportLabel]);

  useEffect(() => {
    lockedRef.current = Boolean(
      config?.lock !== null &&
        config?.lock !== undefined &&
        config.lock.owner === ownerRef.current,
    );
  }, [config]);

  const applyAcquiredControl = useCallback(
    (nextConfig: PowerConfigResponse) => {
      const nextForm = cloneConfig(nextConfig);
      lockedRef.current = true;
      setConfig(nextConfig);
      setForm(nextForm);
      setDirty(false);
      setAutoApplyFailed(false);
      setOutputModeDraft(null);
      outputModeBaselineSignatureRef.current = serializeOutputModeDraft(
        extractOutputModeDraft(nextForm),
      );
      setOutputModeConflict(false);
      setControlAcquisitionFailed(false);
      setError(null);
    },
    [],
  );

  const requestControl = useCallback(
    async (reason: "manual" | "resume" | "unlocked") => {
      const requestSeq = lockRequestSeqRef.current + 1;
      lockRequestSeqRef.current = requestSeq;
      setError(null);
      setControlAcquisitionFailed(false);
      setLockBusy(true);
      const res = await setPowerLockRef.current(ownerRef.current, true);
      if (!mountedRef.current || lockRequestSeqRef.current !== requestSeq) {
        return res;
      }
      setLockBusy(false);
      if (res.ok) {
        applyAcquiredControl(res.value);
        if (reason === "manual") {
          pushToast({
            message: "Control acquired in this browser.",
            variant: "success",
          });
        }
        return res;
      }
      if (reason !== "manual") {
        const snapshot = await loadPowerConfigRef.current();
        if (!mountedRef.current || lockRequestSeqRef.current !== requestSeq) {
          return res;
        }
        if (snapshot.ok) {
          initializeLoadedConfig(snapshot.value);
          setFreshConfigLoaded(true);
          if (
            snapshot.value.lock?.owner === ownerRef.current ||
            (snapshot.value.lock &&
              snapshot.value.lock.owner !== ownerRef.current)
          ) {
            setControlAcquisitionFailed(false);
            setError(null);
            return res;
          }
        }
        setControlAcquisitionFailed(true);
        setError(null);
        return res;
      }
      setControlAcquisitionFailed(true);
      setError(res.error.message);
      pushToast({
        message: res.error.message,
        variant: res.error.kind === "busy" ? "warning" : "error",
        durationMs: 3200,
      });
      return res;
    },
    [applyAcquiredControl, initializeLoadedConfig, pushToast],
  );

  useEffect(() => {
    if (!canControlHardware || !config || !freshConfigLoaded) {
      return;
    }
    if (config.lock?.owner === ownerRef.current) {
      autoAcquireAttemptKeyRef.current = null;
      setControlAcquisitionFailed(false);
      setError(null);
      return;
    }
    if (config.lock && config.lock.owner !== ownerRef.current) {
      autoAcquireAttemptKeyRef.current = null;
      setControlAcquisitionFailed(false);
      return;
    }
    const reason = canResumePowerLock(deviceKey) ? "resume" : "unlocked";
    const attemptKey = `${sharedRevision}:${reason}`;
    if (autoAcquireAttemptKeyRef.current === attemptKey) {
      return;
    }
    autoAcquireAttemptKeyRef.current = attemptKey;
    void requestControl(reason);
  }, [
    canControlHardware,
    config,
    deviceKey,
    freshConfigLoaded,
    requestControl,
    sharedRevision,
  ]);

  const controlledInThisTab =
    config?.lock !== null &&
    config?.lock !== undefined &&
    config.lock.owner === ownerRef.current;
  const lockedByOtherHost =
    config?.lock !== null &&
    config?.lock !== undefined &&
    config.lock.owner !== ownerRef.current;
  const crossTabSyncUnavailable = coordination.role === "unsupported";
  const sharedCommandBusy =
    sharedCommand?.state === "queued" || sharedCommand?.state === "running";
  const ownSharedSaveBusy =
    sharedCommandBusy &&
    isOwnSharedSaveCommand(sharedCommand, coordination.currentTabId);
  const blockingSharedCommandBusy =
    sharedCommandBusy && sharedCommand?.method !== "savePowerConfig";
  const optimisticSaveActive = saveInFlight || ownSharedSaveBusy;
  const outputModeDirty = outputModeDraft !== null;
  const showAcquireControl =
    !controlledInThisTab &&
    !lockedByOtherHost &&
    (crossTabSyncUnavailable || controlAcquisitionFailed);
  const lockStatusLabel = controlledInThisTab
    ? "Controlled here"
    : lockedByOtherHost
      ? "Locked by another host"
      : "Unlocked";
  const lockStatusTone = controlledInThisTab
    ? "border-[var(--badge-success-border)] bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]"
    : lockedByOtherHost
      ? "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]"
      : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]";
  const advancedDisabled =
    localAdvancedLocked ||
    lockedByOtherHost ||
    idleBiasRunning ||
    !controlledInThisTab ||
    blockingSharedCommandBusy ||
    (optimisticSaveActive && slowSavePhase === "lock");
  const powerControlsDisabled =
    advancedDisabled || busy || idleBiasBusy || lockBusy;
  const outputModeSaveDisabled =
    powerControlsDisabled ||
    saveInFlight ||
    !outputModeDirty ||
    outputModeConflict;
  const restoreDisabled = powerControlsDisabled || saveInFlight;

  const acquireControl = async () => {
    await requestControl("manual");
  };

  const applyFormChange = (update: (current: FormState) => FormState) => {
    const currentForm = formRef.current;
    if (!currentForm) {
      return;
    }
    setForm(update(currentForm));
    setDirty(true);
    setAutoApplyFailed(false);
    setError(null);
  };

  const applyOutputModeChange = (update: (current: FormState) => FormState) => {
    const currentForm = formRef.current;
    if (!currentForm) {
      return;
    }
    const nextForm = update(currentForm);
    const nextOutputModeDraft = extractOutputModeDraft(nextForm);
    const nextOutputModeSignature =
      serializeOutputModeDraft(nextOutputModeDraft);
    setForm(nextForm);
    if (
      outputModeBaselineSignatureRef.current !== null &&
      nextOutputModeSignature === outputModeBaselineSignatureRef.current
    ) {
      setOutputModeDraft(null);
      setOutputModeConflict(false);
    } else {
      setOutputModeDraft(nextOutputModeDraft);
    }
    setAutoApplyFailed(false);
    setError(null);
  };

  const setTpsMode = (mode: FormState["tps_mode"]) => {
    applyOutputModeChange((current) => ({ ...current, tps_mode: mode }));
  };

  const setLightLoadMode = (mode: FormState["light_load_mode"]) => {
    applyFormChange((current) => ({ ...current, light_load_mode: mode }));
  };

  const setManualNumber = (
    key: "voltage_mv" | "current_limit_ma",
    value: number,
  ) => {
    applyOutputModeChange((current) => ({
      ...current,
      manual: {
        ...current.manual,
        [key]: Number.isFinite(value) ? value : current.manual[key],
      },
    }));
  };

  const setManualTpsCdcRise = (
    value: FormState["manual"]["tps_cdc_rise_mv"],
  ) => {
    applyOutputModeChange((current) => ({
      ...current,
      manual: {
        ...current.manual,
        tps_cdc_rise_mv: value,
      },
    }));
  };

  const setSw2303LineCompensation = (
    value: FormState["sw2303_line_compensation"],
  ) => {
    applyFormChange((current) => ({
      ...current,
      sw2303_line_compensation: value,
    }));
  };

  const setPowerWatts = (value: number) => {
    applyFormChange((current) => ({
      ...current,
      capability: {
        ...current.capability,
        power_watts: value,
      },
    }));
  };

  const setPathMode = (mode: PowerConfigManualInput["usb_c_path_mode"]) => {
    applyOutputModeChange((current) => ({
      ...current,
      manual: { ...current.manual, usb_c_path_mode: mode },
    }));
  };

  const setProtocol = (
    key: keyof FormState["capability"]["protocols"],
    value: boolean,
  ) => {
    applyFormChange((current) => ({
      ...current,
      capability: {
        ...current.capability,
        protocols: { ...current.capability.protocols, [key]: value },
      },
    }));
  };

  const setPps = (value: boolean) => {
    applyFormChange((current) => ({
      ...current,
      capability: {
        ...current.capability,
        pd: {
          ...current.capability.pd,
          pps: value,
        },
      },
    }));
  };

  const setCurrentProfile = (
    key: keyof FormState["capability"]["current"],
    value: number | boolean,
  ) => {
    applyFormChange((current) => ({
      ...current,
      capability: {
        ...current.capability,
        current: {
          ...current.capability.current,
          [key]: value,
        },
      },
    }));
  };

  const setFastChargeConfig = (
    key: keyof FormState["capability"]["fast_charge"],
    value: boolean,
  ) => {
    applyFormChange((current) => ({
      ...current,
      capability: {
        ...current.capability,
        fast_charge: {
          ...current.capability.fast_charge,
          [key]: value,
        },
      },
    }));
  };

  const toggleFixedVoltage = (mv: number) => {
    applyFormChange((current) => {
      if (!current) {
        return current;
      }
      const exists = current.capability.pd.fixed_voltages_mv.includes(mv);
      const fixed_voltages_mv = exists
        ? current.capability.pd.fixed_voltages_mv.filter(
            (value) => value !== mv,
          )
        : [...current.capability.pd.fixed_voltages_mv, mv].sort(
            (a, b) => a - b,
          );
      return {
        ...current,
        capability: {
          ...current.capability,
          pd: {
            ...current.capability.pd,
            fixed_voltages_mv,
          },
        },
      };
    });
  };

  const activeProtocol = pdDiagnostics?.active_protocol ?? null;
  const fixedVoltageSummary = formatFixedVoltageSummary(
    form?.capability.pd.fixed_voltages_mv ?? [],
  );

  const submit = useCallback(
    async (nextForm: FormState, source: "auto" | "output_mode") => {
      const submittedSnapshot = serializeAutoApplyForm(nextForm);
      saveStartedAtRef.current = Date.now();
      setSaveInFlight(true);
      setSlowSavePhase("idle");
      setError(null);
      const res = await savePowerConfig(nextForm, ownerRef.current);
      if (!mountedRef.current) {
        return;
      }
      setSaveInFlight(false);
      if (res.ok) {
        const canonicalForm = cloneConfig(res.value);
        const canonicalOutputMode = extractOutputModeDraft(canonicalForm);
        const canonicalOutputModeSignature =
          serializeOutputModeDraft(canonicalOutputMode);
        const latestForm = formRef.current;
        let nextLocalForm = canonicalForm;
        let nextHasAutoApplyChanges = false;
        let nextOutputModeDraft: OutputModeDraft | null = null;

        if (latestForm) {
          nextHasAutoApplyChanges =
            serializeAutoApplyForm(
              applyOutputModeDraft(latestForm, canonicalOutputMode),
            ) !== serializeAutoApplyForm(canonicalForm);
          const latestOutputModeDraft = extractOutputModeDraft(latestForm);
          if (
            serializeOutputModeDraft(latestOutputModeDraft) !==
            canonicalOutputModeSignature
          ) {
            nextOutputModeDraft = latestOutputModeDraft;
          }
        } else if (
          submittedSnapshot !== serializeAutoApplyForm(canonicalForm)
        ) {
          nextHasAutoApplyChanges = true;
        }

        if (latestForm && nextHasAutoApplyChanges) {
          nextLocalForm = mergeNonOutputModeFields(nextLocalForm, latestForm);
        }
        if (nextOutputModeDraft) {
          nextLocalForm = applyOutputModeDraft(
            nextLocalForm,
            nextOutputModeDraft,
          );
        }

        setConfig(res.value);
        setForm(nextLocalForm);
        setDirty(nextHasAutoApplyChanges);
        setAutoApplyFailed(false);
        setOutputModeDraft(nextOutputModeDraft);
        outputModeBaselineSignatureRef.current = canonicalOutputModeSignature;
        setOutputModeConflict(false);
        if (source === "output_mode" && nextOutputModeDraft === null) {
          pushToast({
            message: "Output mode saved and applied.",
            variant: "success",
          });
        }
      } else {
        if (source === "auto") {
          setAutoApplyFailed(true);
        }
        setError(res.error.message);
        pushToast({
          message: res.error.message,
          variant: res.error.kind === "busy" ? "warning" : "error",
          durationMs: 3200,
        });
      }
    },
    [pushToast, savePowerConfig],
  );

  const restore = async () => {
    setBusy(true);
    setRestoringDefaults(true);
    setError(null);
    const res = await restorePowerDefaults(ownerRef.current);
    setBusy(false);
    setRestoringDefaults(false);
    if (res.ok) {
      const restoredForm = cloneConfig(res.value);
      setConfig(res.value);
      setForm(restoredForm);
      setDirty(false);
      setAutoApplyFailed(false);
      setOutputModeDraft(null);
      outputModeBaselineSignatureRef.current = serializeOutputModeDraft(
        extractOutputModeDraft(restoredForm),
      );
      setOutputModeConflict(false);
      pushToast({
        message: "Power defaults restored.",
        variant: "success",
      });
    } else {
      setError(res.error.message);
      pushToast({
        message: res.error.message,
        variant: res.error.kind === "busy" ? "warning" : "error",
        durationMs: 3200,
      });
    }
  };

  useEffect(() => {
    if (
      !dirty ||
      autoApplyFailed ||
      saveInFlight ||
      busy ||
      lockBusy ||
      idleBiasBusy ||
      !form ||
      !controlledInThisTab ||
      lockedByOtherHost
    ) {
      return;
    }
    const currentForm =
      config === null
        ? form
        : applyOutputModeDraft(
            form,
            extractOutputModeDraft(cloneConfig(config)),
          );
    const timeoutId = window.setTimeout(() => {
      void submit(currentForm, "auto");
    }, AUTO_APPLY_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    autoApplyFailed,
    busy,
    config,
    controlledInThisTab,
    dirty,
    form,
    idleBiasBusy,
    lockBusy,
    lockedByOtherHost,
    saveInFlight,
    submit,
  ]);

  useEffect(() => {
    if (!outputModeConflict || !outputModeDirty) {
      outputModeConflictToastKeyRef.current = null;
      return;
    }
    const toastKey = `${deviceKey}:${sharedRevision}`;
    if (outputModeConflictToastKeyRef.current === toastKey) {
      return;
    }
    outputModeConflictToastKeyRef.current = toastKey;
    pushToast({
      id: `${deviceKey}:output-mode-conflict`,
      message:
        "Output mode changed in another tab. Refresh the page before saving this draft.",
      variant: "warning",
      durationMs: 3200,
    });
  }, [
    deviceKey,
    outputModeConflict,
    outputModeDirty,
    pushToast,
    sharedRevision,
  ]);

  useEffect(() => {
    if (!optimisticSaveActive) {
      setSlowSavePhase("idle");
      slowLockToastShownRef.current = false;
      return;
    }
    const referenceStartedAt = resolveSlowSaveReferenceStartedAtMs({
      saveInFlight,
      sharedCommand,
      currentTabId: coordination.currentTabId,
      localStartedAtMs: saveStartedAtRef.current,
    });
    if (referenceStartedAt === null) {
      setSlowSavePhase("pending");
      return;
    }
    const elapsed = Math.max(0, Date.now() - referenceStartedAt);
    const nextPhase = resolveSlowSavePhase(elapsed);
    setSlowSavePhase(nextPhase);
    const nextDelay = resolveNextSlowSaveDelayMs(elapsed);
    if (nextDelay === null) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setSlowSavePhase(
        resolveSlowSavePhase(Math.max(0, Date.now() - referenceStartedAt)),
      );
    }, nextDelay);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    coordination.currentTabId,
    optimisticSaveActive,
    saveInFlight,
    sharedCommand,
  ]);

  useEffect(() => {
    if (slowSavePhase === "idle" || slowSavePhase === "pending") {
      slowLockToastShownRef.current = false;
      return;
    }
    if (slowLockToastShownRef.current) {
      return;
    }
    slowLockToastShownRef.current = true;
    pushToast({
      id: `${deviceKey}:slow-save`,
      message:
        slowSavePhase === "lock"
          ? "Saving is taking longer than usual. Controls pause until the device confirms the update."
          : "Saving is still in progress. You can keep editing while the device confirms the update.",
      variant: "info",
      durationMs: 3200,
    });
  }, [deviceKey, pushToast, slowSavePhase]);

  useEffect(() => {
    if (!blockingSharedCommandBusy || !sharedCommand) {
      blockingCommandToastKeyRef.current = null;
      return;
    }
    const toastKey = `${sharedCommand.requestId}:${sharedCommand.state}`;
    if (blockingCommandToastKeyRef.current === toastKey) {
      return;
    }
    blockingCommandToastKeyRef.current = toastKey;
    pushToast({
      id: `${deviceKey}:blocking-command`,
      message:
        "Another device action is running in this browser. Power controls will resume when it finishes.",
      variant: "info",
      durationMs: 2400,
    });
  }, [blockingSharedCommandBusy, deviceKey, pushToast, sharedCommand]);

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

  const toggleRuntime = async (
    action: "output" | "discharge",
    enabled: boolean,
  ) => {
    setBusy(true);
    setError(null);
    const res = await setPowerRuntimeRef.current(
      ownerRef.current,
      action,
      enabled,
    );
    setBusy(false);
    if (res.ok) {
      setConfig(res.value);
      pushToast({
        message:
          action === "output"
            ? `Power ${enabled ? "enabled" : "disabled"}.`
            : `TPS discharge ${enabled ? "enabled" : "disabled"}.`,
        variant: "success",
      });
    } else {
      setError(res.error.message);
      pushToast({
        message: res.error.message,
        variant: res.error.kind === "busy" ? "warning" : "error",
        durationMs: 3200,
      });
    }
  };

  const runtimeOutputEnabled = config?.runtime?.output_enabled ?? true;
  const runtimeDischargeEnabled = config?.runtime?.discharge_enabled ?? false;
  const manualHighVoltageWarning =
    form.tps_mode === "manual" && form.manual.voltage_mv > 5000;

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
            className={`inline-flex h-7 items-center rounded-full border px-3 font-semibold ${idleBiasRunning ? "border-[var(--badge-warning-border)] bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "border-[var(--border)] bg-[var(--btn-disabled-fill-soft)] text-[var(--muted)]"}`}
          >
            {idleBiasRunning ? "Calibration running" : "Calibration idle"}
          </span>
          {showAcquireControl ? (
            <ActionButton
              tone="primary"
              loading={lockBusy}
              disabled={lockBusy}
              onClick={() => void acquireControl()}
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
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "auto_follow" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
                  disabled={powerControlsDisabled}
                  onClick={() => setTpsMode("auto_follow")}
                  type="button"
                >
                  Auto follow
                </button>
                <button
                  className={`min-w-0 flex-1 rounded-[6px] px-3 text-[13px] font-semibold sm:min-w-[112px] ${form.tps_mode === "manual" ? "bg-[var(--primary)] text-[var(--primary-text)]" : "text-[var(--muted)]"} ${powerControlsDisabled ? "opacity-60" : ""}`}
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
                    className={`flex min-h-[88px] flex-col items-start justify-between rounded-[8px] border px-3 py-3 text-left ${form.manual.usb_c_path_mode === value ? "border-[var(--primary)] bg-[var(--panel-3)]" : "border-[var(--border-subtle)] bg-[var(--panel)]"} ${powerControlsDisabled || form.tps_mode !== "manual" ? "opacity-60" : ""}`}
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
                  onClick={() => form && void submit(form, "output_mode")}
                >
                  Save and apply
                </ActionButton>
                <ActionButton
                  className="min-w-[176px]"
                  loading={restoringDefaults}
                  tone="warning"
                  disabled={restoreDisabled}
                  onClick={() => void restore()}
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

        <DevicePowerPanelIdleBiasSection
          busy={busy}
          clearIdleBiasCalibration={(owner) => clearIdleBiasCalibration(owner)}
          initialIdleBias={idleBiasSnapshot}
          loadIdleBias={loadIdleBias}
          lockedByOtherHost={lockedByOtherHost}
          onBusyChange={setIdleBiasBusy}
          onRunningChange={setIdleBiasRunning}
          owner={ownerRef.current}
          runIdleBiasCalibration={(owner) => runIdleBiasCalibration(owner)}
          setIdleBiasCorrection={(enabled, owner) =>
            setIdleBiasCorrection(enabled, owner)
          }
        />
      </div>
    </section>
  );
}
