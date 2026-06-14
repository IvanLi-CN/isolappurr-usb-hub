import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

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
            void updateSW(true);
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
    onOfflineReady() {
      toast.success("IsolaPurr is ready for offline launch.", {
        duration: 3000,
      });
    },
    onRegisterError(error) {
      console.error("PWA registration failed", error);
    },
  });
}
