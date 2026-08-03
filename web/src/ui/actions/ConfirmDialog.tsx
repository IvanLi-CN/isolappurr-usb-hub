import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { ActionButton, type ActionTone } from "./ActionButton";

export function ConfirmDialog({
  busy = false,
  cancelLabel = "Cancel",
  confirmLabel,
  description,
  children,
  confirmDisabled = false,
  initialFocusRef,
  actionsLayout = "default",
  onCancel,
  onConfirm,
  open,
  title,
  tone = "warning",
}: {
  busy?: boolean;
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  confirmDisabled?: boolean;
  description: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  actionsLayout?: "default" | "stack-narrow";
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: Extract<ActionTone, "warning" | "danger">;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? cancelRef.current)?.focus();
    const frame = window.requestAnimationFrame(() => {
      (initialFocusRef?.current ?? cancelRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [initialFocusRef, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="iso-confirm-backdrop" role="presentation">
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="iso-confirm"
        data-tone={tone}
        ref={dialogRef}
        role="alertdialog"
      >
        <div className="iso-confirm__title" id={titleId}>
          {title}
        </div>
        <div className="iso-confirm__description" id={descriptionId}>
          {description}
        </div>
        {children ? (
          <div className="iso-confirm__content">{children}</div>
        ) : null}
        <div className="iso-confirm__actions" data-layout={actionsLayout}>
          <ActionButton
            disabled={busy}
            ref={cancelRef}
            tone="secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </ActionButton>
          <ActionButton
            emphasis={tone === "danger" ? "solid" : "soft"}
            disabled={confirmDisabled}
            loading={busy}
            tone={tone}
            onClick={onConfirm}
          >
            {confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
