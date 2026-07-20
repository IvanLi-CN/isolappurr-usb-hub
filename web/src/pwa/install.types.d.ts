type PwaPromptOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: PwaPromptOutcome;
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
  getTitlebarAreaRect(): DOMRect;
}

interface Navigator {
  standalone?: boolean;
  windowControlsOverlay?: WindowControlsOverlay;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
