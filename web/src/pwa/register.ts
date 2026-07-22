import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

import { PWA_UPDATE_AVAILABLE_EVENT } from "./events";
import {
  createPwaUpdateCandidateStore,
  createPwaUpdateScheduler,
} from "./update";

function suppressLifecycleToasts(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.search.includes("demo=true");
}

export function registerPwaUpdatePrompt() {
  if (import.meta.env.DEV) {
    return;
  }

  let updateToastId: string | number | undefined;
  const updateCandidateStore = createPwaUpdateCandidateStore(
    typeof window === "undefined" ? null : window.sessionStorage,
  );
  let updateScheduler: ReturnType<typeof createPwaUpdateScheduler> | undefined;
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event(PWA_UPDATE_AVAILABLE_EVENT));
      const candidateFingerprint =
        updateScheduler?.getCurrentFingerprint() ?? "waiting-worker";
      if (!updateCandidateStore.shouldPrompt(candidateFingerprint)) {
        return;
      }

      updateToastId = toast("A new IsolaPurr console is ready.", {
        description: "Apply the update to reload the offline app shell.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Update",
          onClick: () => {
            if (updateToastId !== undefined) {
              toast.dismiss(updateToastId);
            }
            void updateSW(true).catch((error) => {
              console.error("PWA update activation failed", error);
              toast.error("The update could not be applied.", {
                description:
                  "Try again after the current app shell finishes recovering.",
                duration: 5000,
              });
            });
          },
        },
        cancel: {
          label: "Later",
          onClick: () => {
            updateCandidateStore.dismiss(candidateFingerprint);
            if (updateToastId !== undefined) {
              toast.dismiss(updateToastId);
            }
          },
        },
      });
    },
    onRegisteredSW(swUrl, registration) {
      if (!registration || typeof window === "undefined") {
        return;
      }

      updateScheduler?.dispose();
      updateScheduler = createPwaUpdateScheduler({
        document,
        registration,
        swUrl,
        window,
      });
    },
    onNeedReload() {
      if (updateToastId !== undefined) {
        toast.dismiss(updateToastId);
        updateToastId = undefined;
      }
    },
    onOfflineReady() {
      if (suppressLifecycleToasts()) {
        return;
      }
      toast.success("IsolaPurr is ready for offline launch.", {
        duration: 3000,
      });
    },
    onRegisterError(error) {
      console.error("PWA registration failed", error);
    },
  });
}
