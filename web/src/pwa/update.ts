const DISMISSED_CANDIDATE_KEY = "isolapurr:pwa-dismissed-update-candidate";

export type PwaUpdateCheckReason =
  | "startup"
  | "visibility"
  | "online"
  | "interval";

type MinimalDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>;
type MinimalWindow = Pick<
  Window,
  "addEventListener" | "clearInterval" | "removeEventListener" | "setInterval"
> & {
  navigator?: Pick<Navigator, "onLine">;
  online?: boolean;
};

type MinimalRegistration = Pick<ServiceWorkerRegistration, "update">;

type SchedulerOptions = {
  document: MinimalDocument;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  now?: () => number;
  onCheck?: (reason: PwaUpdateCheckReason) => void;
  registration: MinimalRegistration;
  swUrl: string;
  window: MinimalWindow;
};

function fingerprintText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return `sw-${(hash >>> 0).toString(16)}`;
}

function isOnline(targetWindow: MinimalWindow): boolean {
  if (typeof targetWindow.navigator?.onLine === "boolean") {
    return targetWindow.navigator.onLine;
  }
  if (typeof targetWindow.online === "boolean") {
    return targetWindow.online;
  }
  return true;
}

function canCheck(
  targetDocument: MinimalDocument,
  targetWindow: MinimalWindow,
): boolean {
  return (
    targetDocument.visibilityState === "visible" &&
    isOnline(targetWindow) === true
  );
}

export function createPwaUpdateCandidateStore(storage?: Storage | null) {
  function readDismissedCandidate(): string | null {
    if (!storage) {
      return null;
    }

    try {
      return storage.getItem(DISMISSED_CANDIDATE_KEY);
    } catch {
      return null;
    }
  }

  return {
    dismiss(candidateFingerprint: string) {
      if (!storage) {
        return;
      }

      try {
        storage.setItem(DISMISSED_CANDIDATE_KEY, candidateFingerprint);
      } catch {
        // Ignore storage failures so update prompting still works.
      }
    },
    shouldPrompt(candidateFingerprint: string) {
      return readDismissedCandidate() !== candidateFingerprint;
    },
  };
}

export function createPwaUpdateScheduler({
  document,
  fetchImpl = fetch,
  intervalMs = 60 * 60 * 1000,
  now = Date.now,
  onCheck,
  registration,
  swUrl,
  window,
}: SchedulerOptions) {
  let currentFingerprint: string | null = null;
  let inFlight: Promise<void> | null = null;
  let lastIntervalCheckAt = 0;

  async function probe(reason: PwaUpdateCheckReason, honorInterval: boolean) {
    if (!canCheck(document, window)) {
      return;
    }

    const currentNow = now();
    if (honorInterval && lastIntervalCheckAt !== 0) {
      if (currentNow - lastIntervalCheckAt < intervalMs) {
        return;
      }
    }

    onCheck?.(reason);
    const response = await fetchImpl(swUrl, { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const nextFingerprint = fingerprintText(await response.text());
    const shouldUpdate =
      currentFingerprint === null || currentFingerprint !== nextFingerprint;
    currentFingerprint = nextFingerprint;
    if (honorInterval) {
      lastIntervalCheckAt = currentNow;
    }
    if (shouldUpdate) {
      await registration.update();
    }
  }

  function run(reason: PwaUpdateCheckReason, honorInterval = false) {
    if (inFlight) {
      return inFlight;
    }

    inFlight = probe(reason, honorInterval)
      .catch((error) => {
        console.error("PWA update probe failed", error);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const intervalId = window.setInterval(() => {
    void run("interval", true);
  }, intervalMs);

  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    void run("visibility");
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const handleOnline = () => {
    void run("online");
  };
  window.addEventListener("online", handleOnline);

  const startupCheck = run("startup");

  return {
    checkNow(reason: PwaUpdateCheckReason) {
      return run(reason);
    },
    dispose() {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    },
    flush() {
      return startupCheck;
    },
    getCurrentFingerprint() {
      return currentFingerprint ?? "waiting-worker";
    },
  };
}
