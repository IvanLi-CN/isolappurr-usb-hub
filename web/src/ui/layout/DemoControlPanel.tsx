import { useEffect, useMemo, useRef, useState } from "react";
import {
  readDemoWorldSummary,
  resetDemoModeSession,
  useDemoMode,
} from "../../app/demo-mode";
import { useDemoNavigate } from "../../app/demo-navigation";

export function DemoControlPanel() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useDemoNavigate();
  const { clear, exitHref } = useDemoMode();
  const [{ savedDeviceCount, discoveryDeviceCount }, setSummary] = useState(
    () => readDemoWorldSummary(),
  );
  const [open, setOpen] = useState(false);

  const panelLabel = useMemo(
    () =>
      `${savedDeviceCount} saved · ${Math.max(
        0,
        discoveryDeviceCount - savedDeviceCount,
      )} available to add`,
    [discoveryDeviceCount, savedDeviceCount],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const closePanel = () => {
    setOpen(false);
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  };

  const refreshSummary = () => {
    setSummary(readDemoWorldSummary());
  };

  const handleReset = () => {
    resetDemoModeSession();
    refreshSummary();
    closePanel();
  };

  const handleExit = () => {
    clear();
    closePanel();
    navigate(exitHref, { replace: true });
  };

  return (
    <>
      <button
        ref={triggerRef}
        className="flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] px-3 text-left text-[12px] font-bold text-[var(--text)] transition-colors hover:border-[var(--warning)] hover:text-[var(--warning)] sm:px-4"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          refreshSummary();
          setOpen(true);
        }}
      >
        <span className="inline-flex h-5 items-center rounded-full bg-[var(--badge-warning-bg)] px-2 text-[11px] font-bold text-[var(--badge-warning-text)]">
          Demo
        </span>
        <span className="hidden text-[var(--muted)] lg:inline">
          {panelLabel}
        </span>
        <span aria-hidden="true" className="text-[10px] text-[var(--muted)]">
          ▾
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="modal modal-bottom sm:modal-middle"
        aria-label="Demo control panel"
        data-testid="demo-control-panel"
        onCancel={(event) => {
          event.preventDefault();
          closePanel();
        }}
        onClose={() => {
          if (open) {
            setOpen(false);
          }
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) {
            closePanel();
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== dialogRef.current) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            closePanel();
          }
        }}
      >
        <div
          className={[
            "demo-sheet-box modal-box iso-modal flex max-h-[min(80dvh,44rem)] w-full max-w-none flex-col overflow-y-auto border border-[var(--border)] bg-[var(--panel)] px-5 pb-6 pt-4 text-[var(--text)] sm:w-[480px] sm:max-w-[calc(100vw-32px)] sm:rounded-[20px] sm:px-6 sm:pt-5",
            "rounded-t-[24px] rounded-b-none sm:rounded-[20px]",
          ].join(" ")}
        >
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--border)] sm:hidden" />

          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex h-7 items-center rounded-full bg-[var(--badge-warning-bg)] px-3 text-[12px] font-bold text-[var(--badge-warning-text)]">
                Demo mode
              </div>
              <div className="mt-3 text-[20px] font-bold leading-7">
                Demo control panel
              </div>
              <div className="mt-2 max-w-[34ch] text-[13px] font-medium leading-6 text-[var(--muted)]">
                This session uses the canonical demo world. Only API boundaries
                are mocked; routes and page logic stay on the production SPA.
              </div>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[18px] leading-none text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              type="button"
              aria-label="Close demo control panel"
              onClick={closePanel}
            >
              ×
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
              <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-[var(--muted)]">
                Saved devices
              </div>
              <div className="mt-2 text-[28px] font-bold leading-none">
                {savedDeviceCount}
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
                Session-only device records used by Dashboard and detail routes.
              </div>
            </div>
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4">
              <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-[var(--muted)]">
                Discovery ready
              </div>
              <div className="mt-2 text-[28px] font-bold leading-none">
                {Math.max(0, discoveryDeviceCount - savedDeviceCount)}
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-5 text-[var(--muted)]">
                Additional demo hubs available through discovery or manual add.
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4 text-[12px] font-semibold leading-6 text-[var(--muted)]">
            Demo state lives only in <code>sessionStorage</code>. Exiting clears
            the canonical world for this tab and returns the SPA to non-demo
            behavior.
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              className="flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-4 text-[14px] font-bold text-[var(--text)] transition-colors hover:bg-[var(--panel-2)]"
              type="button"
              onClick={handleReset}
            >
              Reset demo session
            </button>
            <button
              className="flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--primary)] px-4 text-[14px] font-bold text-[var(--primary-text)] transition-colors hover:bg-[var(--primary-2)]"
              type="button"
              onClick={handleExit}
            >
              Exit demo
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
