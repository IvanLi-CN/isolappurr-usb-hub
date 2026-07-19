import { describe, expect, test } from "bun:test";

import { createPwaInstallController, type PwaDisplayMode } from "./install";

class MockMediaQueryList extends EventTarget implements MediaQueryList {
  matches: boolean;
  media: string;
  onchange:
    | ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown)
    | null = null;

  constructor(media: string, matches = false) {
    super();
    this.media = media;
    this.matches = matches;
  }

  dispatch(matches: boolean) {
    this.matches = matches;
    const event = new Event("change") as MediaQueryListEvent;
    this.onchange?.call(this, event);
    this.dispatchEvent(event);
  }

  addListener(listener: (event: MediaQueryListEvent) => void) {
    this.addEventListener("change", listener as EventListener);
  }

  removeListener(listener: (event: MediaQueryListEvent) => void) {
    this.removeEventListener("change", listener as EventListener);
  }
}

class MockWindowControlsOverlay
  extends EventTarget
  implements WindowControlsOverlay
{
  visible = false;

  dispatch(visible: boolean) {
    this.visible = visible;
    this.dispatchEvent(new Event("geometrychange"));
  }

  getTitlebarAreaRect() {
    return new DOMRect(0, 0, 0, 0);
  }
}

class MockWindow extends EventTarget {
  navigator: Navigator;
  readonly queries = new Map<string, MockMediaQueryList>();
  readonly overlay = new MockWindowControlsOverlay();

  constructor() {
    super();
    this.navigator = {
      standalone: false,
      windowControlsOverlay: this.overlay,
    };
  }

  matchMedia(query: string): MediaQueryList {
    let existing = this.queries.get(query);
    if (!existing) {
      existing = new MockMediaQueryList(query);
      this.queries.set(query, existing);
    }
    return existing;
  }

  setDisplayMode(mode: PwaDisplayMode) {
    this.queries
      .get("(display-mode: fullscreen)")
      ?.dispatch(mode === "fullscreen");
    this.queries
      .get("(display-mode: standalone)")
      ?.dispatch(mode === "standalone");
    this.queries
      .get("(display-mode: minimal-ui)")
      ?.dispatch(mode === "minimal-ui");
  }
}

class MockBeforeInstallPromptEvent
  extends Event
  implements BeforeInstallPromptEvent
{
  readonly platforms = ["web"];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  promptCalls = 0;

  constructor(
    outcome: "accepted" | "dismissed",
    private readonly afterPrompt?: () => void,
  ) {
    super("beforeinstallprompt", { cancelable: true });
    this.userChoice = Promise.resolve({
      outcome,
      platform: "web",
    });
  }

  async prompt() {
    this.promptCalls += 1;
    this.afterPrompt?.();
  }
}

function createMockWindow(): MockWindow {
  const target = new MockWindow();
  target.matchMedia("(display-mode: fullscreen)");
  target.matchMedia("(display-mode: standalone)");
  target.matchMedia("(display-mode: minimal-ui)");
  return target;
}

describe("createPwaInstallController", () => {
  test("captures the deferred prompt and exposes a promptable snapshot", () => {
    const target = createMockWindow();
    const controller = createPwaInstallController(target as unknown as Window);
    const event = new MockBeforeInstallPromptEvent("dismissed");

    expect(controller.getSnapshot()).toEqual({
      canPromptInstall: false,
      displayMode: "browser",
      installStatus: "browser",
      isInstalled: false,
      isWindowControlsOverlayVisible: false,
    });

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(controller.getSnapshot()).toEqual({
      canPromptInstall: true,
      displayMode: "browser",
      installStatus: "promptable",
      isInstalled: false,
      isWindowControlsOverlayVisible: false,
    });

    controller.dispose();
  });

  test("clears the prompt after it is accepted and marks the shell installed", async () => {
    const target = createMockWindow();
    const controller = createPwaInstallController(target as unknown as Window);
    const event = new MockBeforeInstallPromptEvent("accepted", () => {
      target.dispatchEvent(new Event("appinstalled"));
    });

    target.dispatchEvent(event);

    await expect(controller.promptInstall()).resolves.toBe("accepted");
    expect(event.promptCalls).toBe(1);
    expect(controller.getSnapshot()).toEqual({
      canPromptInstall: false,
      displayMode: "browser",
      installStatus: "installed",
      isInstalled: true,
      isWindowControlsOverlayVisible: false,
    });

    controller.dispose();
  });

  test("returns unavailable when no deferred prompt is available", async () => {
    const target = createMockWindow();
    const controller = createPwaInstallController(target as unknown as Window);

    await expect(controller.promptInstall()).resolves.toBe("unavailable");

    controller.dispose();
  });

  test("tracks standalone and window-controls-overlay display modes", () => {
    const target = createMockWindow();
    const controller = createPwaInstallController(target as unknown as Window);

    target.setDisplayMode("standalone");
    expect(controller.getSnapshot()).toEqual({
      canPromptInstall: false,
      displayMode: "standalone",
      installStatus: "installed",
      isInstalled: true,
      isWindowControlsOverlayVisible: false,
    });

    target.overlay.dispatch(true);
    expect(controller.getSnapshot()).toEqual({
      canPromptInstall: false,
      displayMode: "window-controls-overlay",
      installStatus: "installed",
      isInstalled: true,
      isWindowControlsOverlayVisible: true,
    });

    controller.dispose();
  });
});
