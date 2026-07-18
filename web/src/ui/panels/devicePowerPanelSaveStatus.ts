import type { SharedRuntimeCommandState } from "../../app/device-runtime-support";

export const AUTO_APPLY_TOAST_DELAY_MS = 3_000;
export const AUTO_APPLY_LOCK_DELAY_MS = 6_000;

export type SlowSavePhase = "idle" | "pending" | "toast" | "lock";

export function isOwnSharedSaveCommand(
  command: SharedRuntimeCommandState | null,
  currentTabId: string,
): boolean {
  return Boolean(
    command &&
      command.method === "savePowerConfig" &&
      command.sourceTabId === currentTabId &&
      (command.state === "queued" || command.state === "running"),
  );
}

export function resolveSlowSaveReferenceStartedAtMs({
  saveInFlight,
  sharedCommand,
  currentTabId,
  localStartedAtMs,
}: {
  saveInFlight: boolean;
  sharedCommand: SharedRuntimeCommandState | null;
  currentTabId: string;
  localStartedAtMs: number | null;
}): number | null {
  if (!saveInFlight && !isOwnSharedSaveCommand(sharedCommand, currentTabId)) {
    return null;
  }

  if (isOwnSharedSaveCommand(sharedCommand, currentTabId)) {
    if (!sharedCommand?.startedAt) {
      return null;
    }
    const startedAtMs = Date.parse(sharedCommand.startedAt);
    return Number.isFinite(startedAtMs) ? startedAtMs : null;
  }

  if (typeof localStartedAtMs !== "number") {
    return null;
  }
  return Number.isFinite(localStartedAtMs) ? localStartedAtMs : null;
}

export function resolveSlowSavePhase(elapsedMs: number): SlowSavePhase {
  if (elapsedMs >= AUTO_APPLY_LOCK_DELAY_MS) {
    return "lock";
  }
  if (elapsedMs >= AUTO_APPLY_TOAST_DELAY_MS) {
    return "toast";
  }
  return "pending";
}

export function resolveNextSlowSaveDelayMs(elapsedMs: number): number | null {
  if (elapsedMs < AUTO_APPLY_TOAST_DELAY_MS) {
    return AUTO_APPLY_TOAST_DELAY_MS - elapsedMs;
  }
  if (elapsedMs < AUTO_APPLY_LOCK_DELAY_MS) {
    return AUTO_APPLY_LOCK_DELAY_MS - elapsedMs;
  }
  return null;
}
