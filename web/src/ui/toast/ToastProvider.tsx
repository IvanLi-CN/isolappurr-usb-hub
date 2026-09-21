import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Toaster, toast } from "sonner";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastInput = {
  id?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

type SonnerTheme = "light" | "dark";

function resolveSonnerTheme(): SonnerTheme {
  if (typeof window === "undefined") {
    return "light";
  }
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "isolapurr-dark") {
    return "dark";
  }
  if (theme === "isolapurr") {
    return "light";
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function useSonnerTheme(): SonnerTheme {
  const [theme, setTheme] = useState(resolveSonnerTheme);

  useEffect(() => {
    const updateTheme = () => setTheme(resolveSonnerTheme());
    const root = document.documentElement;
    const observer =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(updateTheme);
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

    observer?.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    mediaQuery?.addEventListener("change", updateTheme);
    updateTheme();

    return () => {
      observer?.disconnect();
      mediaQuery?.removeEventListener("change", updateTheme);
    };
  }, []);

  return theme;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useSonnerTheme();
  const pushToast = useCallback((input: ToastInput) => {
    const variant = input.variant ?? "info";
    const durationMs = input.durationMs ?? 2500;
    const action = input.action
      ? {
          label: input.action.label,
          onClick: () => {
            input.action?.onClick();
            if (input.id) {
              toast.dismiss(input.id);
            }
          },
        }
      : undefined;
    toast[variant](input.message, {
      action,
      duration: durationMs,
      id: input.id,
    });
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        closeButton
        richColors
        theme={theme}
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "border border-[var(--border)] bg-[var(--panel)] text-[var(--text)]",
            success:
              "border border-[var(--toast-success-border)] bg-[var(--toast-success-bg)] text-[var(--toast-success-text)]",
            description: "text-[var(--muted)]",
            actionButton:
              "bg-[var(--primary)] text-[var(--primary-text)] font-bold",
            cancelButton:
              "border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)] font-bold",
          },
        }}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}
