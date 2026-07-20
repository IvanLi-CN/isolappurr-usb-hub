import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

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
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
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
            if (updateToastId !== undefined) {
              toast.dismiss(updateToastId);
            }
          },
        },
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
