import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

export type PwaDisplayMode =
  | "browser"
  | "fullscreen"
  | "minimal-ui"
  | "standalone"
  | "window-controls-overlay";

export type PwaInstallStatus = "browser" | "installed" | "promptable";

export type PwaInstallPromptResult = "accepted" | "dismissed" | "unavailable";

export type PwaInstallSnapshot = {
  canPromptInstall: boolean;
  displayMode: PwaDisplayMode;
  installStatus: PwaInstallStatus;
  isInstalled: boolean;
  isWindowControlsOverlayVisible: boolean;
};

export type PwaInstallContextValue = PwaInstallSnapshot & {
  promptInstall: () => Promise<PwaInstallPromptResult>;
};

type PwaInstallProviderProps = {
  children: ReactNode;
  mockValue?: Partial<PwaInstallContextValue>;
};

type PwaInstallController = {
  dispose: () => void;
  getSnapshot: () => PwaInstallSnapshot;
  promptInstall: () => Promise<PwaInstallPromptResult>;
  subscribe: (listener: () => void) => () => void;
};

type DisplayModeQuery = {
  media: `(display-mode: ${Exclude<PwaDisplayMode, "window-controls-overlay">})`;
  mode: Exclude<PwaDisplayMode, "window-controls-overlay">;
};

const DISPLAY_MODE_QUERIES: DisplayModeQuery[] = [
  { media: "(display-mode: fullscreen)", mode: "fullscreen" },
  { media: "(display-mode: standalone)", mode: "standalone" },
  { media: "(display-mode: minimal-ui)", mode: "minimal-ui" },
];

const DEFAULT_SNAPSHOT: PwaInstallSnapshot = {
  canPromptInstall: false,
  displayMode: "browser",
  installStatus: "browser",
  isInstalled: false,
  isWindowControlsOverlayVisible: false,
};

const DEFAULT_CONTEXT: PwaInstallContextValue = {
  ...DEFAULT_SNAPSHOT,
  promptInstall: async () => "unavailable",
};

const PwaInstallContext =
  createContext<PwaInstallContextValue>(DEFAULT_CONTEXT);

function sameSnapshot(
  left: PwaInstallSnapshot,
  right: PwaInstallSnapshot,
): boolean {
  return (
    left.canPromptInstall === right.canPromptInstall &&
    left.displayMode === right.displayMode &&
    left.installStatus === right.installStatus &&
    left.isInstalled === right.isInstalled &&
    left.isWindowControlsOverlayVisible === right.isWindowControlsOverlayVisible
  );
}

function buildSnapshot(
  target: Window,
  queries: ReadonlyArray<readonly [DisplayModeQuery["mode"], MediaQueryList]>,
  deferredPrompt: BeforeInstallPromptEvent | null,
  installedByEvent: boolean,
): PwaInstallSnapshot {
  const overlayVisible =
    target.navigator.windowControlsOverlay?.visible === true;
  const displayMode = overlayVisible
    ? "window-controls-overlay"
    : (queries.find(([, query]) => query.matches)?.[0] ?? "browser");
  const isInstalled =
    installedByEvent ||
    target.navigator.standalone === true ||
    displayMode !== "browser";
  const canPromptInstall = !isInstalled && deferredPrompt !== null;

  return {
    canPromptInstall,
    displayMode,
    installStatus: isInstalled
      ? "installed"
      : canPromptInstall
        ? "promptable"
        : "browser",
    isInstalled,
    isWindowControlsOverlayVisible: overlayVisible,
  };
}

export function createPwaInstallController(
  target: Window | undefined = typeof window === "undefined"
    ? undefined
    : window,
): PwaInstallController {
  if (!target) {
    return {
      dispose: () => {},
      getSnapshot: () => DEFAULT_SNAPSHOT,
      promptInstall: async () => "unavailable",
      subscribe: () => () => {},
    };
  }

  let disposed = false;
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installedByEvent = false;
  const listeners = new Set<() => void>();
  const queries = DISPLAY_MODE_QUERIES.map(
    (entry) => [entry.mode, target.matchMedia(entry.media)] as const,
  );
  let snapshotCache = buildSnapshot(
    target,
    queries,
    deferredPrompt,
    installedByEvent,
  );

  const readSnapshot = () => {
    const nextSnapshot = buildSnapshot(
      target,
      queries,
      deferredPrompt,
      installedByEvent,
    );
    if (!sameSnapshot(snapshotCache, nextSnapshot)) {
      snapshotCache = nextSnapshot;
    }
    return snapshotCache;
  };

  const emit = () => {
    if (disposed) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  };

  const onDisplayModeChange = () => {
    emit();
  };

  const onBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
    event.preventDefault();
    deferredPrompt = event;
    emit();
  };

  const onAppInstalled = () => {
    installedByEvent = true;
    deferredPrompt = null;
    emit();
  };

  for (const [, query] of queries) {
    query.addEventListener("change", onDisplayModeChange);
  }
  target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  target.addEventListener("appinstalled", onAppInstalled);
  target.navigator.windowControlsOverlay?.addEventListener(
    "geometrychange",
    onDisplayModeChange,
  );

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const [, query] of queries) {
        query.removeEventListener("change", onDisplayModeChange);
      }
      target.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      target.removeEventListener("appinstalled", onAppInstalled);
      target.navigator.windowControlsOverlay?.removeEventListener(
        "geometrychange",
        onDisplayModeChange,
      );
      listeners.clear();
    },
    getSnapshot: () => readSnapshot(),
    promptInstall: async () => {
      const snapshot = readSnapshot();
      if (!snapshot.canPromptInstall || !deferredPrompt) {
        return "unavailable";
      }

      const pendingPrompt = deferredPrompt;
      deferredPrompt = null;
      emit();

      try {
        await pendingPrompt.prompt();
        const choice = await pendingPrompt.userChoice;
        return choice.outcome === "accepted" ? "accepted" : "dismissed";
      } catch {
        emit();
        return "unavailable";
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function PwaInstallProvider({
  children,
  mockValue,
}: PwaInstallProviderProps) {
  const controllerRef = useRef<PwaInstallController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createPwaInstallController();
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const value = useMemo(
    () => ({
      ...snapshot,
      promptInstall: controller.promptInstall,
    }),
    [controller, snapshot],
  );

  const resolvedValue = mockValue ? { ...value, ...mockValue } : value;

  return (
    <PwaInstallContext.Provider value={resolvedValue}>
      {children}
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallContextValue {
  return useContext(PwaInstallContext);
}
