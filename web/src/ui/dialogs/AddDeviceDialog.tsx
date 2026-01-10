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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [id, setId] = useState("");
  const [errors, setErrors] = useState<AddDeviceValidationErrors>({});

  const ids = useMemo(() => existingDeviceIds ?? [], [existingDeviceIds]);

  useEffect(() => {
    if (!dialogRef.current) {
      return;
    }

    if (open) {
      setErrors({});
      dialogRef.current.showModal();
      return;
    }

    if (dialogRef.current.open) {
      dialogRef.current.close();
    }
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

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal-box">
        <h3 className="text-lg font-bold">Add device</h3>

        <div className="mt-4 flex flex-col gap-3">
          <label className="form-control w-full">
            <div className="label">
              <span className="label-text">Name</span>
            </div>
            <input
              className={`input input-bordered w-full ${errors.name ? "input-error" : ""}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My USB hub"
              autoComplete="off"
            />
            {errors.name ? (
              <div className="label">
                <span className="label-text-alt text-error">{errors.name}</span>
              </div>
            ) : null}
          </label>

          <label className="form-control w-full">
            <div className="label">
              <span className="label-text">Base URL</span>
            </div>
            <input
              className={`input input-bordered w-full ${errors.baseUrl ? "input-error" : ""}`}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://192.168.1.23"
              autoComplete="off"
            />
            {errors.baseUrl ? (
              <div className="label">
                <span className="label-text-alt text-error">
                  {errors.baseUrl}
                </span>
              </div>
            ) : null}
          </label>

          <label className="form-control w-full">
            <div className="label">
              <span className="label-text">ID (optional)</span>
            </div>
            <input
              className={`input input-bordered w-full ${errors.id ? "input-error" : ""}`}
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="auto-generated if empty"
              autoComplete="off"
            />
            {errors.id ? (
              <div className="label">
                <span className="label-text-alt text-error">{errors.id}</span>
              </div>
            ) : null}
          </label>
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={submit}>
            Create
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">close</button>
      </form>
    </dialog>
  );
}
