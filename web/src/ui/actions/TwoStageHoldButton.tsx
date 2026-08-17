import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Result } from "../../domain/deviceApi";
import {
  PortStateIcon,
  portStateIconKind,
  portStateLabel,
} from "../status/PortStateIcon";

export type HoldActionResult = { ok: true } | { ok: false; message: string };

export function toHoldActionResult(result: Result<unknown>): HoldActionResult {
  return result.ok
    ? { ok: true }
    : { ok: false, message: result.error.message };
}

export type TwoStageHoldPhase =
  | "idle"
  | "holding"
  | "stage-one"
  | "waiting"
  | "confirmed"
  | "error"
  | "hint"
  | "external";

export type TwoStageHoldTone = "neutral" | "warning" | "success" | "error";

export type TwoStageHoldStage =
  | "first"
  | "first-complete"
  | "second"
  | "result";

export type PortHoldControlLabel = "Power" | "Data link";

/**
 * Stable visual checkpoint for Storybook and visual-regression coverage.
 * Product code omits this and is always driven by the live hold state machine.
 */
export type TwoStageHoldPreview = {
  phase: TwoStageHoldPhase;
  stage: TwoStageHoldStage;
  tone: TwoStageHoldTone;
  holdProgress?: number;
  restoreProgress?: number;
  message?: string;
  tooltipOpen?: boolean;
};

type TwoStageHoldButtonProps = {
  label: PortHoldControlLabel;
  value: boolean;
  disabled?: boolean;
  unavailableReason?: string;
  compact?: boolean;
  className?: string;
  testId?: string;
  preview?: TwoStageHoldPreview;
  onSetValue: (next: boolean) => Promise<HoldActionResult>;
};

const FIRST_STAGE_MS = 600;
const SECOND_STAGE_MS = 1250;
const STAGE_ONE_FEEDBACK_MS = 160;
const RESULT_VISIBLE_MS = 2800;

function actionLabel(label: string, next: boolean): string {
  return `${next ? "Enable" : "Disable"} ${label.toLowerCase()}`;
}

export function TwoStageHoldButton({
  label,
  value,
  disabled = false,
  unavailableReason,
  compact = false,
  className,
  testId,
  preview,
  onSetValue,
}: TwoStageHoldButtonProps) {
  const tooltipId = useId();
  const [phase, setPhase] = useState<TwoStageHoldPhase>("idle");
  const [firstProgress, setFirstProgress] = useState(0);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const firstTimerRef = useRef<number | null>(null);
  const secondTimerRef = useRef<number | null>(null);
  const stageOneFeedbackTimerRef = useRef<number | null>(null);
  const resultTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const busyRef = useRef(false);
  const firstStartedRef = useRef(false);
  const firstConfirmedRef = useRef(false);
  const secondDueRef = useRef(false);
  const secondStartedRef = useRef(false);
  const initialValueRef = useRef(value);
  const expectedValueRef = useRef(value);
  const priorValueRef = useRef(value);
  const confirmedStageRef = useRef<"first" | "second" | null>(null);
  const sessionRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const activeKeyboardKeyRef = useRef<" " | "Enter" | null>(null);
  const pointerHoldRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const releaseHoldRef = useRef<(cancelled?: boolean) => void>(() => {});

  const clearTimers = useCallback(() => {
    if (firstTimerRef.current !== null) {
      window.clearTimeout(firstTimerRef.current);
      firstTimerRef.current = null;
    }
    if (secondTimerRef.current !== null) {
      window.clearTimeout(secondTimerRef.current);
      secondTimerRef.current = null;
    }
    if (stageOneFeedbackTimerRef.current !== null) {
      window.clearTimeout(stageOneFeedbackTimerRef.current);
      stageOneFeedbackTimerRef.current = null;
    }
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const showResult = useCallback(
    (nextPhase: TwoStageHoldPhase, nextMessage: string) => {
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
      }
      setPhase(nextPhase);
      setMessage(nextMessage);
      resultTimerRef.current = window.setTimeout(() => {
        setPhase("idle");
        setMessage("");
        resultTimerRef.current = null;
      }, RESULT_VISIBLE_MS);
    },
    [],
  );

  const runSecondStage = async (session: number) => {
    if (
      !holdingRef.current ||
      !firstConfirmedRef.current ||
      secondStartedRef.current ||
      session !== sessionRef.current
    ) {
      return;
    }
    secondStartedRef.current = true;
    busyRef.current = true;
    const target = initialValueRef.current;
    expectedValueRef.current = target;
    setRestoreProgress(1);
    setPhase("waiting");
    setMessage(`Confirming ${actionLabel(label, target)}...`);
    let result: HoldActionResult;
    try {
      result = await onSetValue(target);
    } catch {
      result = { ok: false, message: `${label} request failed. Try again.` };
    } finally {
      busyRef.current = false;
    }
    if (session !== sessionRef.current) {
      return;
    }
    if (!result.ok) {
      holdingRef.current = false;
      clearTimers();
      showResult("error", result.message);
      return;
    }
    confirmedStageRef.current = "second";
    showResult("confirmed", `${label} restored`);
  };

  const runFirstStage = async (session: number) => {
    if (firstStartedRef.current || session !== sessionRef.current) {
      return;
    }
    firstStartedRef.current = true;
    busyRef.current = true;
    const target = !initialValueRef.current;
    expectedValueRef.current = target;
    setPhase("waiting");
    setMessage(`Confirming ${actionLabel(label, target)}...`);
    let result: HoldActionResult;
    try {
      result = await onSetValue(target);
    } catch {
      result = { ok: false, message: `${label} request failed. Try again.` };
    } finally {
      busyRef.current = false;
    }
    if (session !== sessionRef.current) {
      return;
    }
    if (!result.ok) {
      holdingRef.current = false;
      clearTimers();
      showResult("error", result.message);
      return;
    }
    firstConfirmedRef.current = true;
    setFirstProgress(1);
    if (holdingRef.current) {
      setPhase("stage-one");
      setMessage(
        `${label} ${target ? "enabled" : "disabled"}. Keep holding to restore it.`,
      );
      if (secondDueRef.current) {
        stageOneFeedbackTimerRef.current = window.setTimeout(() => {
          stageOneFeedbackTimerRef.current = null;
          void runSecondStage(session);
        }, STAGE_ONE_FEEDBACK_MS);
      }
      return;
    }
    setRestoreProgress(0);
    confirmedStageRef.current = "first";
    showResult("confirmed", `${label} ${target ? "enabled" : "disabled"}`);
  };

  const beginHold = (pointerId?: number, target?: HTMLButtonElement) => {
    if (preview || disabled || busyRef.current || holdingRef.current) {
      return;
    }
    if (resultTimerRef.current !== null) {
      window.clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    holdingRef.current = true;
    firstStartedRef.current = false;
    firstConfirmedRef.current = false;
    secondDueRef.current = false;
    secondStartedRef.current = false;
    confirmedStageRef.current = null;
    pointerHoldRef.current = pointerId !== undefined;
    activePointerIdRef.current = pointerId ?? null;
    suppressNextClickRef.current = false;
    setFirstProgress(0);
    setRestoreProgress(0);
    initialValueRef.current = value;
    expectedValueRef.current = value;
    setPhase("holding");
    setMessage(
      `Hold for ${FIRST_STAGE_MS / 1000}s to ${actionLabel(label, !value).toLowerCase()}`,
    );
    setTooltipOpen(false);
    const startedAt = performance.now();
    const drawProgress = (now: number) => {
      if (!holdingRef.current || session !== sessionRef.current) {
        return;
      }
      const elapsed = now - startedAt;
      setFirstProgress(Math.min(1, elapsed / FIRST_STAGE_MS));
      setRestoreProgress(
        Math.max(
          0,
          Math.min(
            1,
            (elapsed - FIRST_STAGE_MS) / (SECOND_STAGE_MS - FIRST_STAGE_MS),
          ),
        ),
      );
      frameRef.current = window.requestAnimationFrame(drawProgress);
    };
    frameRef.current = window.requestAnimationFrame(drawProgress);
    firstTimerRef.current = window.setTimeout(() => {
      void runFirstStage(session);
    }, FIRST_STAGE_MS);
    secondTimerRef.current = window.setTimeout(() => {
      secondDueRef.current = true;
      if (firstConfirmedRef.current) {
        void runSecondStage(session);
      } else if (holdingRef.current) {
        setPhase("waiting");
        setMessage("Waiting for the first change to confirm...");
      }
    }, SECOND_STAGE_MS);
    if (pointerId !== undefined && target) {
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Synthetic pointer events do not always create an active pointer.
      }
    }
  };

  const releaseHold = useCallback(
    (cancelled = false) => {
      if (!holdingRef.current) {
        return;
      }
      holdingRef.current = false;
      activePointerIdRef.current = null;
      activeKeyboardKeyRef.current = null;
      clearTimers();
      const triggerStarted = firstStartedRef.current;
      const firstConfirmed = firstConfirmedRef.current;
      suppressNextClickRef.current =
        !cancelled && pointerHoldRef.current && triggerStarted;
      if (!triggerStarted) {
        showResult(
          cancelled ? "hint" : "hint",
          `Continue holding about ${FIRST_STAGE_MS / 1000}s to ${actionLabel(label, !initialValueRef.current).toLowerCase()}.`,
        );
        return;
      }
      if (!firstConfirmed) {
        setPhase("waiting");
        setMessage("Waiting for the device to confirm the first change...");
        return;
      }
      if (!secondStartedRef.current) {
        setRestoreProgress(0);
        confirmedStageRef.current = "first";
        showResult(
          "confirmed",
          `${label} ${expectedValueRef.current ? "enabled" : "disabled"}`,
        );
      }
    },
    [clearTimers, label, showResult],
  );

  releaseHoldRef.current = releaseHold;

  useEffect(() => {
    const prior = priorValueRef.current;
    priorValueRef.current = value;
    if (
      holdingRef.current &&
      value !== prior &&
      value !== expectedValueRef.current
    ) {
      holdingRef.current = false;
      sessionRef.current += 1;
      clearTimers();
      showResult("external", `${label} changed elsewhere. Hold again to act.`);
    }
  }, [clearTimers, label, showResult, value]);

  useEffect(() => {
    const cancelForLossOfFocus = () => releaseHoldRef.current(true);
    const releaseForPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === activePointerIdRef.current) {
        releaseHoldRef.current();
      }
    };
    const cancelForPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === activePointerIdRef.current) {
        releaseHoldRef.current(true);
      }
    };
    const releaseForKeyboardEnd = (event: KeyboardEvent) => {
      if (event.key === activeKeyboardKeyRef.current) {
        releaseHoldRef.current();
      }
    };
    const cancelForVisibility = () => {
      if (document.visibilityState !== "visible") {
        releaseHoldRef.current(true);
      }
    };
    window.addEventListener("blur", cancelForLossOfFocus);
    window.addEventListener("pointerup", releaseForPointerEnd);
    window.addEventListener("pointercancel", cancelForPointerEnd);
    window.addEventListener("keyup", releaseForKeyboardEnd);
    document.addEventListener("visibilitychange", cancelForVisibility);
    return () => {
      window.removeEventListener("blur", cancelForLossOfFocus);
      window.removeEventListener("pointerup", releaseForPointerEnd);
      window.removeEventListener("pointercancel", cancelForPointerEnd);
      window.removeEventListener("keyup", releaseForKeyboardEnd);
      document.removeEventListener("visibilitychange", cancelForVisibility);
      if (firstTimerRef.current !== null) {
        window.clearTimeout(firstTimerRef.current);
      }
      if (secondTimerRef.current !== null) {
        window.clearTimeout(secondTimerRef.current);
      }
      if (stageOneFeedbackTimerRef.current !== null) {
        window.clearTimeout(stageOneFeedbackTimerRef.current);
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (resultTimerRef.current !== null) {
        window.clearTimeout(resultTimerRef.current);
      }
    };
  }, []);

  const visualPhase = preview?.phase ?? phase;
  const visualStage =
    preview?.stage ??
    (phase === "stage-one"
      ? "first-complete"
      : secondStartedRef.current
        ? "second"
        : phase === "confirmed" ||
            phase === "error" ||
            phase === "hint" ||
            phase === "external"
          ? "result"
          : "first");
  const visualHoldProgress = preview?.holdProgress ?? firstProgress;
  const visualRestoreProgress = preview?.restoreProgress ?? restoreProgress;
  const secondProgressActive =
    visualStage === "second" ||
    (!preview && visualPhase === "stage-one" && holdingRef.current);
  const visualProgress = secondProgressActive
    ? 1 - visualRestoreProgress
    : visualStage === "first-complete"
      ? 1
      : visualHoldProgress;
  const visualProgressDirection = secondProgressActive ? "reverse" : "forward";
  const visualMessage = preview?.message ?? message;
  const visualTooltipOpen = preview?.tooltipOpen ?? tooltipOpen;
  const visualStateChannel = label === "Data link" ? "data" : "power";
  const visualStateIcon = portStateIconKind(visualStateChannel, value);
  const visualStateLabel = portStateLabel(visualStateChannel, value);
  const visualSuccessStage =
    preview?.phase === "confirmed"
      ? /restored/i.test(preview.message ?? "")
        ? "second"
        : "first"
      : confirmedStageRef.current;
  const tone =
    preview?.tone ??
    (phase === "error" || phase === "external"
      ? "error"
      : phase === "confirmed"
        ? confirmedStageRef.current === "second"
          ? "success"
          : "warning"
        : phase === "holding" || phase === "stage-one" || phase === "waiting"
          ? "warning"
          : "neutral");
  const usage = unavailableReason
    ? unavailableReason
    : `${label} is ${value ? "enabled" : "disabled"}. Hold 0.6s to ${actionLabel(label, !value).toLowerCase()}, or continue to 1.25s to restore the current state.`;
  const toggleTooltip = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setTooltipOpen((open) => !open);
  };
  const feedbackContent = (
    <span
      aria-label={visualStateLabel}
      className="two-stage-hold__feedback"
      role="img"
    >
      <PortStateIcon
        className="two-stage-hold__status-icon"
        kind={visualStateIcon}
      />
    </span>
  );

  return (
    <div
      className={`two-stage-hold${compact ? " two-stage-hold--compact" : ""}${className ? ` ${className}` : ""}`}
      data-phase={visualPhase}
      data-stage={visualStage}
      data-success-stage={visualSuccessStage ?? undefined}
      data-tone={tone}
      data-progress-direction={visualProgressDirection}
      data-tooltip-open={visualTooltipOpen || undefined}
      data-tooltip-placement={compact ? "top" : "bottom"}
      style={
        {
          "--hold-progress": visualProgress,
        } as CSSProperties
      }
    >
      {disabled ? (
        <button
          aria-describedby={tooltipId}
          aria-disabled="true"
          aria-pressed={value}
          className="two-stage-hold__button"
          data-testid={testId}
          onClick={toggleTooltip}
          tabIndex={0}
          type="button"
        >
          <span className="two-stage-hold__label">{label}</span>
          {feedbackContent}
        </button>
      ) : (
        <button
          aria-describedby={tooltipId}
          aria-pressed={value}
          className="two-stage-hold__button"
          data-testid={testId}
          onBlur={() => releaseHold(true)}
          onClick={toggleTooltip}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              activeKeyboardKeyRef.current = event.key;
              beginHold();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              releaseHold();
            }
          }}
          onPointerCancel={() => releaseHold(true)}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            beginHold(event.pointerId, event.currentTarget);
          }}
          onPointerUp={() => releaseHold()}
          type="button"
        >
          <span className="two-stage-hold__label">{label}</span>
          {feedbackContent}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {visualMessage}
      </span>
      <span
        className="two-stage-hold__tooltip"
        data-visible={visualTooltipOpen}
        id={tooltipId}
        role="tooltip"
      >
        {visualMessage || usage}
      </span>
    </div>
  );
}
