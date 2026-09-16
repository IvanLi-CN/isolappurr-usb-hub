import { useEffect, useRef, useState } from "react";
import type {
  DeviceNameMutationResponse,
  Result,
} from "../../domain/deviceApi";
import {
  normalizeDeviceDisplayName,
  validateDeviceDisplayName,
} from "../../domain/deviceName";
import { IconButton } from "../actions/ActionButton";
import { useToast } from "../toast/ToastProvider";
import {
  type DeviceClipboardContent,
  writeDeviceClipboard,
} from "./deviceClipboard";

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="m10.9 2.1 3 3M9.8 3.2 3 10l-.8 3.8L6 13l6.8-6.8m-3-3L13 1.9a1.27 1.27 0 0 1 1.8 1.8l-3.2 3.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <rect
        x="5.2"
        y="5.2"
        width="7.6"
        height="7.6"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M10.8 5.2V3.9c0-.6-.5-1.1-1.1-1.1H4.1c-.6 0-1.1.5-1.1 1.1v5.6c0 .6.5 1.1 1.1 1.1h1.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="m3.1 8.3 3.1 3.1 6.7-6.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
      <path
        d="m4 4 8 8m0-8-8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

type Props = {
  title: string;
  editable?: boolean;
  compact?: boolean;
  titleTestId?: string;
  onSave?: (value: string) => Promise<Result<DeviceNameMutationResponse>>;
  clipboardContent: DeviceClipboardContent;
  writeClipboard?: (content: DeviceClipboardContent) => Promise<void>;
};

export function DeviceHeaderName({
  title,
  editable = false,
  compact = false,
  titleTestId = "app-header-device-title",
  onSave,
  clipboardContent,
  writeClipboard,
}: Props) {
  const { pushToast } = useToast();
  const [committedTitle, setCommittedTitle] = useState(title);
  const [draft, setDraft] = useState(title);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const skipNextTitleSyncRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      if (skipNextTitleSyncRef.current) {
        skipNextTitleSyncRef.current = false;
        return;
      }
      setCommittedTitle(title);
      setDraft(title);
    }
  }, [editing, title]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const startEditing = () => {
    if (!editable || !onSave || saving) {
      return;
    }
    setDraft(committedTitle);
    setError(null);
    setEditing(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancelEditing = () => {
    if (saving) {
      return;
    }
    setDraft(committedTitle);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    if (!onSave || saving) {
      return;
    }
    const value = normalizeDeviceDisplayName(draft);
    const validationError = validateDeviceDisplayName(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(value);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const nextTitle = result.value.display_name ?? value;
      setCommittedTitle(nextTitle);
      setDraft(nextTitle);
      skipNextTitleSyncRef.current = true;
      setEditing(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Device name could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await (writeClipboard ?? writeDeviceClipboard)(clipboardContent);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1600);
      pushToast({ message: "Device info copied.", variant: "success" });
    } catch {
      setError("Could not copy device info.");
      pushToast({
        message: "Could not copy device info.",
        variant: "error",
      });
    }
  };

  const titleClassName = compact
    ? "text-[16px] font-bold leading-6"
    : "text-[24px] font-bold leading-8";
  const iconSize = compact ? "xs" : "sm";
  const actionLabel = editing ? "Save device name" : "Edit device name";

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      data-testid="app-header-device-name"
    >
      {editing ? (
        <div className="min-w-0 max-w-full">
          <input
            ref={inputRef}
            aria-describedby={
              error ? "app-header-device-name-error" : undefined
            }
            aria-label="Device name"
            className={[
              "input input-sm w-auto min-w-[3em] max-w-full border-[var(--border)] bg-[var(--panel)] font-bold [field-sizing:content]",
              compact ? "text-[16px]" : "text-[20px]",
            ].join(" ")}
            data-testid="app-header-device-name-input"
            disabled={saving}
            maxLength={48}
            size={Math.max(3, draft.length)}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
          />
          {error ? (
            <div
              className="mt-1 max-w-[42ch] text-[11px] font-semibold leading-4 text-[var(--error)]"
              id="app-header-device-name-error"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className={["min-w-0 truncate", titleClassName].join(" ")}
          data-testid={titleTestId}
          title={committedTitle}
        >
          {committedTitle}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <IconButton
              disabled={!editable || saving}
              label="Save device name"
              loading={saving}
              size={iconSize}
              tone="primary"
              onClick={() => void save()}
            >
              <CheckIcon />
            </IconButton>
            <IconButton
              disabled={saving}
              label="Cancel editing device name"
              size={iconSize}
              tone="quiet"
              onClick={cancelEditing}
            >
              <CloseIcon />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              disabled={!editable || saving}
              label={actionLabel}
              size={iconSize}
              tone="quiet"
              onClick={startEditing}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              label={copied ? "Device info copied" : "Copy device info"}
              size={iconSize}
              tone={copied ? "primary" : "quiet"}
              onClick={() => void copy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
