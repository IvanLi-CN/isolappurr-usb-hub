import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AddDeviceInput,
  AddDeviceValidationErrors,
} from "../../domain/devices";
import { validateAddDeviceInput } from "../../domain/devices";

export type AddDeviceDialogProps = {
  open: boolean;
  existingDeviceIds?: string[];
  onClose: () => void;
  onCreate: (input: AddDeviceInput) => void;
};

export function AddDeviceDialog({
  open,
  existingDeviceIds,
  onClose,
  onCreate,
}: AddDeviceDialogProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [id, setId] = useState("");
  const [errors, setErrors] = useState<AddDeviceValidationErrors>({});

  const ids = useMemo(() => existingDeviceIds ?? [], [existingDeviceIds]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrors({});
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);

  const submit = () => {
    const input: AddDeviceInput = {
      name,
      baseUrl,
      id: id.trim() ? id : undefined,
    };
    const result = validateAddDeviceInput(input, ids);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    onCreate(input);
    setName("");
    setBaseUrl("");
    setId("");
    setErrors({});
    onClose();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const fieldBase = [
    "h-[52px] w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-5 text-[14px] font-medium text-[var(--text)] outline-none",
    "placeholder:text-[var(--muted)]",
  ].join(" ");

  const fieldError = "border-[var(--error)]";

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        className="absolute inset-0 h-full w-full bg-[var(--overlay)]"
        type="button"
        aria-label="Close add device dialog"
        onClick={onClose}
      />

      <div className="iso-modal fixed left-1/2 top-[172px] flex h-[520px] w-[640px] -translate-x-1/2 flex-col rounded-[22px] border border-[var(--border)] bg-[var(--panel)] px-10 pb-7 pt-6">
        <div className="text-[24px] font-bold">Add device</div>
        <div className="mt-2 text-[14px] font-medium text-[var(--muted)]">
          Store locally; used for Dashboard and device pages.
        </div>

        <div className="mt-10 flex flex-1 flex-col gap-5">
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              Name
            </div>
            <input
              ref={nameRef}
              className={[fieldBase, errors.name ? fieldError : ""].join(" ")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Desk Hub"
              autoComplete="off"
            />
            {errors.name ? (
              <div className="mt-2 text-[12px] font-semibold text-[var(--error)]">
                {errors.name}
              </div>
            ) : null}
          </div>

          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              Base URL
            </div>
            <input
              className={[
                fieldBase,
                "font-mono",
                errors.baseUrl ? fieldError : "",
              ].join(" ")}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://hub-a.local"
              autoComplete="off"
            />
            {errors.baseUrl ? (
              <div className="mt-2 text-[12px] font-semibold text-[var(--error)]">
                {errors.baseUrl}
              </div>
            ) : null}
            <div className="mt-4 text-[12px] font-semibold text-[var(--muted)]">
              Examples: http://&lt;hostname&gt;.local / http://192.168.1.42
            </div>
          </div>

          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">
              ID (optional)
            </div>
            <input
              className={[fieldBase, errors.id ? fieldError : ""].join(" ")}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="auto-generated if empty"
              autoComplete="off"
            />
            {errors.id ? (
              <div className="mt-2 text-[12px] font-semibold text-[var(--error)]">
                {errors.id}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-end gap-[14px]">
          <button
            className="flex h-[44px] w-[132px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] text-[12px] font-bold text-[var(--text)]"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="flex h-[44px] w-[148px] items-center justify-center rounded-[10px] bg-[var(--primary)] text-[12px] font-bold text-[var(--primary-text)]"
            type="button"
            onClick={submit}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
