import { useCallback, useEffect, useRef, useState } from "react";

import type { CrossTabRuntimeLeaseState } from "../../app/cross-tab-runtime";
import type { SharedRuntimeCommandState } from "../../app/device-runtime-support";
import { canResumePowerLock } from "../../app/device-runtime-support";
import type {
  IdleBiasResponse,
  PdDiagnosticsResponse,
  PowerConfigInput,
  PowerConfigResponse,
  Result,
} from "../../domain/deviceApi";
import type { PortState, PortTelemetry } from "../../domain/ports";
import { useToast } from "../toast/ToastProvider";
import {
  badgeTone,
  cloneConfig,
  type FormState,
  formatFixedVoltageSummary,
} from "./DevicePowerPanelControls";
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

export type DevicePowerPanelProps = {
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

export function useDevicePowerPanelState({
  deviceKey,
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
  loadPdDiagnostics,
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
    const loadIdleBiasCurrent = async () => {
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
    const loadPdCurrent = async () => {
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
    void loadIdleBiasCurrent();
    void loadPdCurrent();
    return () => {
      cancelled = true;
    };
  }, [initializeLoadedConfig]);

  useEffect(() => {
    if (form || sharedPowerConfig || coordination.role === "unsupported") {
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
  }, [coordination.role, form, initializeLoadedConfig, sharedPowerConfig]);

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

  const acquireControl = useCallback(async () => {
    await requestControl("manual");
  }, [requestControl]);

  const applyFormChange = useCallback(
    (update: (current: FormState) => FormState) => {
      const currentForm = formRef.current;
      if (!currentForm) {
        return;
      }
      setForm(update(currentForm));
      setDirty(true);
      setAutoApplyFailed(false);
      setError(null);
    },
    [],
  );

  const applyOutputModeChange = useCallback(
    (update: (current: FormState) => FormState) => {
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
    },
    [],
  );

  const setTpsMode = useCallback(
    (mode: FormState["tps_mode"]) => {
      applyOutputModeChange((current) => ({ ...current, tps_mode: mode }));
    },
    [applyOutputModeChange],
  );

  const setLightLoadMode = useCallback(
    (mode: FormState["light_load_mode"]) => {
      applyFormChange((current) => ({ ...current, light_load_mode: mode }));
    },
    [applyFormChange],
  );

  const setManualNumber = useCallback(
    (key: "voltage_mv" | "current_limit_ma", value: number) => {
      applyOutputModeChange((current) => ({
        ...current,
        manual: {
          ...current.manual,
          [key]: Number.isFinite(value) ? value : current.manual[key],
        },
      }));
    },
    [applyOutputModeChange],
  );

  const setManualTpsCdcRise = useCallback(
    (value: FormState["manual"]["tps_cdc_rise_mv"]) => {
      applyOutputModeChange((current) => ({
        ...current,
        manual: {
          ...current.manual,
          tps_cdc_rise_mv: value,
        },
      }));
    },
    [applyOutputModeChange],
  );

  const setSw2303LineCompensation = useCallback(
    (value: FormState["sw2303_line_compensation"]) => {
      applyFormChange((current) => ({
        ...current,
        sw2303_line_compensation: value,
      }));
    },
    [applyFormChange],
  );

  const setPowerWatts = useCallback(
    (value: number) => {
      applyFormChange((current) => ({
        ...current,
        capability: {
          ...current.capability,
          power_watts: value,
        },
      }));
    },
    [applyFormChange],
  );

  const setPathMode = useCallback(
    (mode: FormState["manual"]["usb_c_path_mode"]) => {
      applyOutputModeChange((current) => ({
        ...current,
        manual: { ...current.manual, usb_c_path_mode: mode },
      }));
    },
    [applyOutputModeChange],
  );

  const setProtocol = useCallback(
    (key: keyof FormState["capability"]["protocols"], value: boolean) => {
      applyFormChange((current) => ({
        ...current,
        capability: {
          ...current.capability,
          protocols: { ...current.capability.protocols, [key]: value },
        },
      }));
    },
    [applyFormChange],
  );

  const setPps = useCallback(
    (value: boolean) => {
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
    },
    [applyFormChange],
  );

  const setCurrentProfile = useCallback(
    (
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
    },
    [applyFormChange],
  );

  const setFastChargeConfig = useCallback(
    (key: keyof FormState["capability"]["fast_charge"], value: boolean) => {
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
    },
    [applyFormChange],
  );

  const toggleFixedVoltage = useCallback(
    (mv: number) => {
      applyFormChange((current) => {
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
    },
    [applyFormChange],
  );

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
          const latestOutputMode = extractOutputModeDraft(latestForm);
          if (
            serializeOutputModeDraft(latestOutputMode) !==
            canonicalOutputModeSignature
          ) {
            nextOutputModeDraft = latestOutputMode;
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

  const restoreDefaults = useCallback(async () => {
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
  }, [pushToast, restorePowerDefaults]);

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

  const toggleRuntime = useCallback(
    async (action: "output" | "discharge", enabled: boolean) => {
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
    },
    [pushToast],
  );

  const runtimeOutputEnabled = config?.runtime?.output_enabled ?? true;
  const runtimeDischargeEnabled = config?.runtime?.discharge_enabled ?? false;
  const manualHighVoltageWarning =
    form?.tps_mode === "manual" && (form.manual.voltage_mv ?? 0) > 5000;

  const submitOutputMode = useCallback(async () => {
    if (!form) {
      return;
    }
    await submit(form, "output_mode");
  }, [form, submit]);

  return {
    acquireControl,
    activeProtocol,
    badgeTone,
    busy,
    config,
    controlledInThisTab,
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
    owner: ownerRef.current,
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
  };
}
