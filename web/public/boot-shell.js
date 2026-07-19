(() => {
  const shell = document.getElementById("isolapurr-pwa-boot");
  if (!shell) {
    return;
  }

  const SESSION_KEY = "isolapurr_usb_hub.pwa_boot";
  const RECOVERY_PARAM = "__pwa_recover";
  const STARTUP_TIMEOUT_MS = 8000;
  const WAITING_SW_TIMEOUT_MS = 2800;
  const FAILED_TITLE = "App launch failed";
  const FAILED_MESSAGE =
    "The installed console could not finish loading this app shell.";
  const STALE_SHELL_DETAIL =
    "A cached console shell is still pointing at app files that are no longer available.";
  const TIMEOUT_DETAIL =
    "The launch screen stayed active for too long before the console UI mounted.";
  const REPAIR_NOTE =
    "Repair app resets service workers and cached files without touching saved devices or theme.";

  const titleEl = document.getElementById("isolapurr-pwa-boot-title");
  const messageEl = document.getElementById("isolapurr-pwa-boot-message");
  const detailEl = document.getElementById("isolapurr-pwa-boot-detail");
  const chipEl = shell.querySelector("[data-boot-chip]");
  const progressEl = shell.querySelector("[data-boot-progress]");
  const actionsEl = shell.querySelector("[data-boot-actions]");
  const noteEl = shell.querySelector("[data-boot-note]");
  const entryScript = document.getElementById("isolapurr-main-entry");

  let appMounted = false;
  let recoveryInFlight = false;
  let startupTimer = 0;

  function readSessionState() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        return { waitingPromotionAttempted: false };
      }
      const parsed = JSON.parse(raw);
      return {
        waitingPromotionAttempted: Boolean(parsed.waitingPromotionAttempted),
      };
    } catch {
      return { waitingPromotionAttempted: false };
    }
  }

  function writeSessionState(nextState) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextState));
    } catch {
      // Ignore storage failures inside startup recovery.
    }
  }

  function clearSessionState() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore storage failures inside startup recovery.
    }
  }

  function isStandalone() {
    if (window.matchMedia) {
      const modes = [
        "(display-mode: standalone)",
        "(display-mode: window-controls-overlay)",
        "(display-mode: fullscreen)",
      ];
      if (modes.some((query) => window.matchMedia(query).matches)) {
        return true;
      }
    }
    return Boolean(window.navigator.standalone);
  }

  function setVisible(visible) {
    shell.hidden = !visible;
    if (!visible) {
      shell.setAttribute("aria-hidden", "true");
      return;
    }
    shell.removeAttribute("aria-hidden");
  }

  function setShellState(state, options) {
    shell.dataset.state = state;
    if (titleEl) {
      titleEl.textContent = options.title;
    }
    if (messageEl) {
      messageEl.textContent = options.message;
    }
    if (detailEl) {
      detailEl.textContent = options.detail;
      detailEl.hidden = !options.detail;
    }
    if (chipEl) {
      chipEl.textContent = options.chip;
    }
    if (progressEl) {
      progressEl.hidden = !options.showProgress;
    }
    if (actionsEl) {
      actionsEl.hidden = !options.showActions;
    }
    if (noteEl) {
      noteEl.hidden = !options.showNote;
      noteEl.textContent = options.showNote ? REPAIR_NOTE : "";
    }
  }

  function normalizeFailureDetail(reason) {
    if (reason instanceof Error) {
      return reason.message || FAILED_MESSAGE;
    }
    if (typeof reason === "string" && reason.trim().length > 0) {
      return reason.trim();
    }
    return FAILED_MESSAGE;
  }

  async function promoteWaitingWorker() {
    const serviceWorker = window.navigator.serviceWorker;
    if (!serviceWorker || typeof serviceWorker.getRegistration !== "function") {
      return false;
    }

    const sessionState = readSessionState();
    if (sessionState.waitingPromotionAttempted) {
      return false;
    }

    let registration;
    try {
      registration = await serviceWorker.getRegistration();
    } catch {
      return false;
    }

    if (!registration || !registration.waiting) {
      return false;
    }

    sessionState.waitingPromotionAttempted = true;
    writeSessionState(sessionState);

    setShellState("recovering", {
      chip: "Repairing app shell",
      title: "Repairing the installed console…",
      message: "Switching to the newest offline app shell.",
      detail: "",
      showActions: false,
      showNote: false,
      showProgress: true,
    });

    return await new Promise((resolve) => {
      let settled = false;

      const finish = (recovered) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          serviceWorker.removeEventListener("controllerchange", onController);
        } catch {
          // Ignore listener cleanup failures.
        }
        window.clearTimeout(timer);
        resolve(recovered);
      };

      const onController = () => {
        finish(true);
        window.location.reload();
      };

      try {
        serviceWorker.addEventListener("controllerchange", onController, {
          once: true,
        });
      } catch {
        serviceWorker.addEventListener("controllerchange", onController);
      }

      const timer = window.setTimeout(
        () => finish(false),
        WAITING_SW_TIMEOUT_MS,
      );

      try {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch {
        finish(false);
      }
    });
  }

  function markAppMounted() {
    if (appMounted) {
      return;
    }

    appMounted = true;
    recoveryInFlight = false;
    window.clearTimeout(startupTimer);
    clearSessionState();

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has(RECOVERY_PARAM)) {
      currentUrl.searchParams.delete(RECOVERY_PARAM);
      window.history.replaceState({}, "", currentUrl);
    }

    shell.dataset.state = "ready";
    window.setTimeout(() => setVisible(false), 180);
  }

  function showFailureScreen(detail) {
    recoveryInFlight = false;
    setVisible(true);
    setShellState("failed", {
      chip: "Launch failed",
      title: FAILED_TITLE,
      message: FAILED_MESSAGE,
      detail,
      showActions: true,
      showNote: true,
      showProgress: false,
    });
  }

  async function handleStartupFailure(detail) {
    if (appMounted || recoveryInFlight) {
      return;
    }

    recoveryInFlight = true;
    window.clearTimeout(startupTimer);
    setVisible(true);

    if (await promoteWaitingWorker()) {
      return;
    }

    showFailureScreen(detail);
  }

  async function retryLaunch() {
    clearSessionState();
    window.location.reload();
  }

  async function repairLaunch() {
    setVisible(true);
    setShellState("recovering", {
      chip: "Repairing app shell",
      title: "Repairing the installed console…",
      message:
        "Resetting service workers and cached files for a clean relaunch.",
      detail:
        "Saved devices and theme stay on this Mac. The console will reload after the reset finishes.",
      showActions: false,
      showNote: false,
      showProgress: true,
    });

    clearSessionState();

    try {
      const serviceWorker = window.navigator.serviceWorker;
      if (
        serviceWorker &&
        typeof serviceWorker.getRegistrations === "function"
      ) {
        const registrations = await serviceWorker.getRegistrations();
        await Promise.allSettled(
          registrations.map((registration) => registration.unregister()),
        );
      }
      if (window.caches && typeof window.caches.keys === "function") {
        const keys = await window.caches.keys();
        await Promise.allSettled(keys.map((key) => window.caches.delete(key)));
      }
    } catch {
      // Keep the relaunch path resilient even if cache cleanup partially fails.
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set(RECOVERY_PARAM, Date.now().toString(36));
    window.location.replace(currentUrl.toString());
  }

  function attachActionHandlers() {
    const retryButton = shell.querySelector('[data-boot-action="retry"]');
    const repairButton = shell.querySelector('[data-boot-action="repair"]');

    if (retryButton) {
      retryButton.addEventListener("click", () => {
        void retryLaunch();
      });
    }

    if (repairButton) {
      repairButton.addEventListener("click", () => {
        void repairLaunch();
      });
    }
  }

  function attachFailureObservers() {
    if (entryScript) {
      entryScript.addEventListener("error", () => {
        void handleStartupFailure(STALE_SHELL_DETAIL);
      });
    }

    window.addEventListener(
      "error",
      (event) => {
        if (appMounted) {
          return;
        }

        const target = event.target;
        if (
          target &&
          target !== window &&
          target.tagName === "SCRIPT" &&
          target.src &&
          target.src.indexOf(window.location.origin) === 0
        ) {
          void handleStartupFailure(STALE_SHELL_DETAIL);
          return;
        }

        if (
          typeof event.filename === "string" &&
          event.filename.indexOf(window.location.origin) === 0
        ) {
          void handleStartupFailure(
            normalizeFailureDetail(event.error || event.message),
          );
        }
      },
      true,
    );

    window.addEventListener("unhandledrejection", (event) => {
      if (appMounted) {
        return;
      }
      void handleStartupFailure(normalizeFailureDetail(event.reason));
    });
  }

  window.__ISOLAPURR_PWA_BOOT__ = {
    markAppMounted,
    reportStartupFailure(detail) {
      void handleStartupFailure(normalizeFailureDetail(detail));
    },
  };

  if (!isStandalone()) {
    setVisible(false);
    return;
  }

  setVisible(true);
  setShellState("launching", {
    chip: "Installed console",
    title: "Starting the installed console…",
    message: "Loading your offline app shell.",
    detail: "",
    showActions: false,
    showNote: false,
    showProgress: true,
  });

  attachActionHandlers();
  attachFailureObservers();
  startupTimer = window.setTimeout(() => {
    void handleStartupFailure(TIMEOUT_DETAIL);
  }, STARTUP_TIMEOUT_MS);
})();
