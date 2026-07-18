import { createContext, useCallback, useContext, useMemo } from "react";
import { Toaster, toast } from "sonner";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastInput = {
  id?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const pushToast = useCallback((input: ToastInput) => {
    const variant = input.variant ?? "info";
    const durationMs = input.durationMs ?? 2500;
    toast[variant](input.message, { duration: durationMs, id: input.id });
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        closeButton
        richColors
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
