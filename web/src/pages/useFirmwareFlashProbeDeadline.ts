import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import {
  type FlashTransportMode,
  PROBE_READ_TIMEOUT_MS,
  type ProbeActivity,
  type ProbeActivityStage,
  type ProbeState,
} from "./firmwareFlashShared";

type ProbeDeadlineState = {
  probeActivity: ProbeActivity | null;
  setProbeActivity: Dispatch<SetStateAction<ProbeActivity | null>>;
  setProbeClock: Dispatch<SetStateAction<number>>;
  setProbe: Dispatch<SetStateAction<ProbeState>>;
  setProbing: Dispatch<SetStateAction<boolean>>;
};

type ActiveProbeOperation = {
  generation: number;
  controller: AbortController;
  deadlineAt: number;
  timeoutId: number;
};

export function useFirmwareFlashProbeDeadline({
  probeActivity,
  setProbeActivity,
  setProbeClock,
  setProbe,
  setProbing,
}: ProbeDeadlineState) {
  const generationRef = useRef(0);
  const activeOperationRef = useRef<ActiveProbeOperation | null>(null);
  const expireOperationRef = useRef<(generation: number) => void>(
    () => undefined,
  );

  const startProbeActivity = (
    stage: ProbeActivityStage,
    title: string,
    detail: string,
    timeoutMs: number,
  ) => {
    const now = Date.now();
    setProbeClock(now);
    setProbeActivity({ stage, title, detail, deadlineAt: now + timeoutMs });
  };

  const expireOperation = (generation: number) => {
    const active = activeOperationRef.current;
    if (!active || active.generation !== generation) {
      return;
    }
    active.controller.abort(new Error("Web Serial probe timed out."));
    setProbe({
      kind: "unknown",
      summary: "Probe timed out.",
      detail:
        "The selected Web USB device did not respond within 5 seconds. Reconnect and try again.",
    });
    setProbeActivity(null);
    setProbing(false);
  };
  expireOperationRef.current = expireOperation;

  useEffect(() => {
    if (!probeActivity) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setProbeClock(now);
      const active = activeOperationRef.current;
      if (active && now >= active.deadlineAt) {
        expireOperationRef.current(active.generation);
      }
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [probeActivity, setProbeClock]);

  useEffect(
    () => () => {
      const active = activeOperationRef.current;
      if (active) {
        window.clearTimeout(active.timeoutId);
        active.controller.abort();
      }
    },
    [],
  );

  const createProbeOperation = (transport: FlashTransportMode) => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    const previous = activeOperationRef.current;
    previous?.controller.abort();
    if (previous) {
      window.clearTimeout(previous.timeoutId);
    }
    let deadlineAt = 0;

    const begin = () => {
      if (deadlineAt > 0 || transport !== "web_serial") {
        return;
      }
      deadlineAt = Date.now() + PROBE_READ_TIMEOUT_MS;
      const timeoutId = window.setTimeout(
        () => expireOperationRef.current(generation),
        PROBE_READ_TIMEOUT_MS,
      );
      activeOperationRef.current = {
        generation,
        controller,
        deadlineAt,
        timeoutId,
      };
      startProbeActivity(
        "probing",
        "Reading target identity…",
        "Waiting for the selected transport to respond.",
        PROBE_READ_TIMEOUT_MS,
      );
      setProbe({
        kind: "probing",
        summary: "Reading target identity…",
        detail: "Waiting for the selected transport to respond.",
      });
    };

    return {
      controller,
      deadlineAt: () => deadlineAt,
      begin,
      canPublishError: () =>
        activeOperationRef.current?.generation === generation &&
        !controller.signal.aborted,
      finish: () => {
        const active = activeOperationRef.current;
        const ownsActiveProbe = active?.generation === generation;
        const endedBeforeDeadline =
          deadlineAt === 0 && generationRef.current === generation;
        if (
          transport !== "web_serial" ||
          ownsActiveProbe ||
          endedBeforeDeadline
        ) {
          if (ownsActiveProbe) {
            window.clearTimeout(active.timeoutId);
            activeOperationRef.current = null;
          }
          setProbeActivity(null);
          setProbing(false);
        }
      },
    };
  };

  return { createProbeOperation, startProbeActivity };
}
