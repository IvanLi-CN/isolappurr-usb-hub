import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getDeviceInfo } from "../../domain/deviceApi";
import type {
  AddDeviceInput,
  AddDeviceValidationErrors,
} from "../../domain/devices";
import {
  loadStoredDevices,
  validateAddDeviceInput,
} from "../../domain/devices";
import type { DiscoveredDevice } from "../../domain/discovery";
import {
  applyDiscoveredDeviceToManualForm,
  createInitialDiscoverySnapshot,
  parseCidr,
  parseDiscoveredDeviceFromApiInfo,
  reduceDiscoverySnapshot,
} from "../../domain/discovery";
import { DeviceDiscoveryPanel } from "../panels/DeviceDiscoveryPanel";

export type AddDeviceDialogProps = {
  open: boolean;
  existingDeviceIds?: string[];
  existingDeviceBaseUrls?: string[];
  onClose: () => void;
  onCreate: (input: AddDeviceInput) => void;
};

export function AddDeviceDialog({
  open,
  existingDeviceIds,
  existingDeviceBaseUrls,
  onClose,
  onCreate,
}: AddDeviceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const devicesCountRef = useRef(0);
  const ipScanExpandedRef = useRef(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [id, setId] = useState("");
  const [errors, setErrors] = useState<AddDeviceValidationErrors>({});

  const ids = useMemo(() => existingDeviceIds ?? [], [existingDeviceIds]);
  const baseUrls = useMemo(
    () =>
      existingDeviceBaseUrls ??
      (open ? loadStoredDevices().map((d) => d.baseUrl) : []),
    [existingDeviceBaseUrls, open],
  );

  const [snapshot, dispatch] = useReducer(
    reduceDiscoverySnapshot,
    createInitialDiscoverySnapshot({
      status: "unavailable",
      autoExpandAfterMs: 30_000,
    }),
  );

  const scanRunIdRef = useRef(0);

  useEffect(() => {
    devicesCountRef.current = snapshot.devices.length;
    ipScanExpandedRef.current = snapshot.ipScan?.expanded ?? false;
  }, [snapshot.devices.length, snapshot.ipScan?.expanded]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) {
      return;
    }
    if (open) {
      if (!el.open) {
        el.showModal();
      }
      setErrors({});
      dispatch({ type: "reset", status: "unavailable" });
      window.setTimeout(() => nameRef.current?.focus(), 0);
      return;
    }

    scanRunIdRef.current += 1;
    dispatch({ type: "scan_cancelled" });
    if (el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const ipScan = snapshot.ipScan;
    if (!ipScan || ipScan.expanded) {
      return;
    }
    if (snapshot.mode !== "service" || snapshot.status !== "scanning") {
      return;
    }
    if (!ipScan.autoExpandAfterMs) {
      return;
    }

    const expectedCount = devicesCountRef.current;
    const timer = window.setTimeout(() => {
      if (devicesCountRef.current !== expectedCount) {
        return;
      }
      if (ipScanExpandedRef.current) {
        return;
      }
      dispatch({
        type: "toggle_ip_scan",
        expanded: true,
        expandedBy: "auto",
      });
      dispatch({
        type: "set_error",
        error:
          "No devices found yet — try IP scan (advanced) with a CIDR range.",
      });
    }, ipScan.autoExpandAfterMs);
    return () => window.clearTimeout(timer);
  }, [open, snapshot.ipScan, snapshot.mode, snapshot.status]);

  const submit = () => {
    const input: AddDeviceInput = {
      name,
      baseUrl,
      id: id.trim() ? id : undefined,
    };
    const result = validateAddDeviceInput(input, ids, baseUrls);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fieldBase = [
    "h-[52px] w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel-2)] px-5 text-[14px] font-medium text-[var(--text)] outline-none",
    "placeholder:text-[var(--muted)]",
  ].join(" ");

  const fieldError = "border-[var(--error)]";

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Add device"
      data-testid="add-device-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== dialogRef.current) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="modal-box iso-modal h-[680px] w-[1040px] max-w-[calc(100vw-32px)] rounded-[22px] border border-[var(--border)] bg-[var(--panel)] px-8 pb-7 pt-6">
        <div className="text-[24px] font-bold">Add device</div>
        <div className="mt-2 text-[14px] font-medium text-[var(--muted)]">
          Store locally; used for Dashboard and device pages.
        </div>

        <div className="mt-6 grid min-h-0 flex-1 grid-cols-1 gap-6 min-[980px]:grid-cols-2">
          <DeviceDiscoveryPanel
            snapshot={snapshot}
            existingDeviceIds={ids}
            existingDeviceBaseUrls={baseUrls}
            onRefresh={() => {
              scanRunIdRef.current += 1;
              dispatch({ type: "reset", status: "unavailable" });
            }}
            onToggleIpScan={(expanded) =>
              dispatch({
                type: "toggle_ip_scan",
                expanded,
                expandedBy: "user",
              })
            }
            onStartScan={(cidr) => {
              const parsed = parseCidr(cidr);
              if (!parsed.ok) {
                dispatch({ type: "set_error", error: parsed.error });
                return;
              }

              scanRunIdRef.current += 1;
              const runId = scanRunIdRef.current;

              dispatch({
                type: "start_scan",
                cidr: parsed.cidr,
                total: parsed.hosts.length,
              });

              const concurrency = 12;
              let nextIndex = 0;
              let done = 0;
              let preflightBlocked = false;

              const worker = async () => {
                for (;;) {
                  if (scanRunIdRef.current !== runId) {
                    return;
                  }
                  const idx = nextIndex;
                  nextIndex += 1;
                  if (idx >= parsed.hosts.length) {
                    return;
                  }

                  const ip = parsed.hosts[idx];
                  const baseUrlByIp = `http://${ip}`;
                  const res = await getDeviceInfo(baseUrlByIp);
                  if (scanRunIdRef.current !== runId) {
                    return;
                  }
                  done += 1;
                  dispatch({ type: "scan_progress", done });

                  if (!res.ok) {
                    if (res.error.kind === "preflight_blocked") {
                      preflightBlocked = true;
                    }
                    continue;
                  }

                  const nowIso = new Date().toISOString();
                  const device = parseDiscoveredDeviceFromApiInfo(
                    baseUrlByIp,
                    res.value as unknown,
                    ip,
                    nowIso,
                  );
                  if (!device) {
                    continue;
                  }
                  dispatch({ type: "scan_device", device });
                }
              };

              void (async () => {
                await Promise.all(
                  Array.from({ length: concurrency }, () => worker()),
                );
                if (scanRunIdRef.current !== runId) {
                  return;
                }
                if (preflightBlocked) {
                  dispatch({
                    type: "set_error",
                    error:
                      "Local network access blocked (PNA/CORS preflight). Try allowing private network access, or use Manual add.",
                  });
                }
                dispatch({ type: "scan_done" });
              })();
            }}
            onCancelScan={() => {
              scanRunIdRef.current += 1;
              dispatch({ type: "scan_cancelled" });
            }}
            onSelect={(device: DiscoveredDevice) => {
              const next = applyDiscoveredDeviceToManualForm(
                { name, baseUrl, id },
                device,
              );
              setName(next.name);
              setBaseUrl(next.baseUrl);
              setId(next.id);
              setErrors({});
            }}
          />

          <div className="flex h-full min-h-0 flex-col">
            <div>
              <div className="text-[16px] font-bold">Manual add</div>
              <div className="mt-2 text-[12px] font-semibold text-[var(--muted)]">
                Always available; requires Name and Base URL.
              </div>
            </div>

            <div className="mt-6 flex min-h-0 flex-1 flex-col gap-5">
              <div>
                <div className="text-[12px] font-semibold text-[var(--muted)]">
                  Name
                </div>
                <input
                  ref={nameRef}
                  className={[fieldBase, errors.name ? fieldError : ""].join(
                    " ",
                  )}
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

            <div className="mt-6 flex items-center justify-end gap-[14px]">
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={submit}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
