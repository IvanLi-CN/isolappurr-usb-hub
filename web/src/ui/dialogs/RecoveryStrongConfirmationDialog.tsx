import { useId, useRef } from "react";

import { ConfirmDialog } from "../actions/ConfirmDialog";

export type RecoveryStrongConfirmationDialogProps = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RecoveryStrongConfirmationDialog({
  onCancel,
  onChange,
  onConfirm,
  open,
  value,
}: RecoveryStrongConfirmationDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmed = value.trim() === "FLASH";

  return (
    <ConfirmDialog
      actionsLayout="stack-narrow"
      confirmDisabled={!confirmed}
      confirmLabel="Confirm recovery flash"
      description={
        <>
          This recovery write may target a download-mode board, damaged
          firmware, or non-IsolaPurr hardware. Type{" "}
          <span className="font-mono text-[var(--text)]">FLASH</span> to
          continue with the selected recovery image.
        </>
      }
      initialFocusRef={inputRef}
      open={open}
      title="Flash a target that is not confirmed as IsolaPurr?"
      tone="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <label className="iso-confirm__field" htmlFor={inputId}>
        <span className="iso-confirm__field-label">Confirmation code</span>
        <input
          ref={inputRef}
          autoComplete="off"
          className="iso-confirm__input"
          data-confirmed={confirmed || undefined}
          id={inputId}
          placeholder="FLASH"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
    </ConfirmDialog>
  );
}
