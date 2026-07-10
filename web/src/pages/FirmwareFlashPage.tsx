import { useSearchParams } from "react-router";
import { useDemoMode } from "../app/demo-mode";
import { useDemoNavigate } from "../app/demo-navigation";
import { useDevices } from "../app/devices-store";
import { isWebSerialSupported } from "../domain/hardwareConsole";
import { getLocalUsbDeviceLink } from "../domain/localUsbLinks";
import { FirmwareFlashLogPanel } from "../ui/panels/FirmwareFlashLogPanel";
import { FirmwareFlashTargetState } from "../ui/panels/FirmwareFlashTargetState";
import { FirmwareReleaseList } from "../ui/panels/FirmwareReleaseList";
import {
  FlashSummaryRow,
  outlineButtonClass,
  primaryButtonClass,
  ReconnectIcon,
  RemoveIcon,
  SpinnerIcon,
  TargetInfoCell,
  TransportChoiceCard,
} from "./FirmwareFlashPageUi";
import {
  boardValue,
  cardClassName,
  type FlashActivityStatus,
  probeToneClass,
  summaryValue,
  transportLabel,
} from "./firmwareFlashShared";
import { useFirmwareFlashAction } from "./useFirmwareFlashAction";
import { useFirmwareFlashConnection } from "./useFirmwareFlashConnection";

export function FirmwareFlashPage() {
  const navigate = useDemoNavigate();
  const { enabled: demoEnabled } = useDemoMode();
  const { getDevice } = useDevices();
  const [searchParams] = useSearchParams();
  const requestedDeviceId = searchParams.get("deviceId") ?? undefined;
  const demoProbeReading =
    demoEnabled && searchParams.get("probe") === "reading";
  const demoAuthorizedWebUsb =
    demoEnabled &&
    (searchParams.get("webUsb") === "authorized" || demoProbeReading);
  const currentDevice = requestedDeviceId
    ? getDevice(requestedDeviceId)
    : undefined;
  const currentLocalUsbPath = currentDevice
    ? (getLocalUsbDeviceLink(currentDevice.id) ??
      currentDevice.transports?.localUsbPortPath)
    : undefined;
  const webSerialSupported = isWebSerialSupported();
  const connection = useFirmwareFlashConnection({
    currentDevice,
    currentLocalUsbPath,
    demoEnabled,
    demoProbeReading,
    demoAuthorizedWebUsb,
    webSerialSupported,
  });
  const { onFlash, performFlash } = useFirmwareFlashAction(
    connection,
    demoEnabled,
  );
  const {
    flashActivity,
    flashBusy,
    flashError,
    flashLogs,
    localFile,
    localUsbDialogRef,
    localUsbPickerOpen,
    localUsbPorts,
    manualAddress,
    manifestError,
    openLocalUsbPicker,
    openWebUsbPicker,
    pendingConnectionAction,
    probe,
    probeActivity,
    probeClock,
    probing,
    readAuthorizedWebUsb,
    recoveryFlow,
    releaseAuthorizedWebUsb,
    releaseChoices,
    selectedAsset,
    selectedLocalUsbPort,
    selectedLocalUsbPortInfo,
    selectedRelease,
    selectedReleaseTag,
    selectedWebSerialSelection,
    selectLocalUsbPort,
    setFlashMode,
    setFlashModeReason,
    setLocalFile,
    setLocalUsbPickerOpen,
    setManualAddress,
    setSelectedReleaseTag,
    setSourceMode,
    setStrongConfirmOpen,
    setStrongConfirmText,
    sourceMode,
    strongConfirmOpen,
    strongConfirmText,
    strongConfirmationRequired,
    targetNeedsStrongConfirmation,
    transportMode,
    webSerialReadyForManualRead,
    webUsbPickerOpen,
  } = connection;

  const transportSummary =
    transportMode === null ? "Not connected" : transportLabel(transportMode);
  const selectedVersionLabel =
    sourceMode === "releases"
      ? summaryValue(selectedRelease?.version)
      : summaryValue(localFile?.name);
  const selectedSourceLabel =
    sourceMode === "releases" ? "Bundled release" : "Local file";
  const flashModeLabel = recoveryFlow ? "Recovery" : "Normal update";
  const confirmationLabel = strongConfirmationRequired
    ? "Strong confirm"
    : "Confirm";
  const addressLabel =
    sourceMode === "releases"
      ? summaryValue(
          selectedAsset
            ? `0x${selectedAsset.flashAddress.toString(16).toUpperCase()}`
            : null,
          manualAddress,
        )
      : summaryValue(manualAddress);
  const operationLocked =
    probing || flashBusy || webUsbPickerOpen || localUsbPickerOpen;
  const localUsbActionBusy =
    pendingConnectionAction === "local_usb_picker" ||
    pendingConnectionAction === "local_usb_probe" ||
    (probing && transportMode === "local_usb");
  const webUsbActionBusy =
    pendingConnectionAction === "web_usb_picker" ||
    pendingConnectionAction === "web_usb_reconnect" ||
    pendingConnectionAction === "web_usb_release" ||
    webUsbPickerOpen ||
    (probing &&
      (transportMode === "web_serial" || Boolean(selectedWebSerialSelection)));
  const reconnectButtonBusy =
    pendingConnectionAction === "web_usb_reconnect" ||
    (probing &&
      transportMode === "web_serial" &&
      Boolean(selectedWebSerialSelection));
  const localUsbStatusLabel =
    pendingConnectionAction === "local_usb_picker"
      ? "Loading"
      : localUsbActionBusy
        ? "Detecting"
        : transportMode === "local_usb" && selectedLocalUsbPort
          ? "Selected"
          : "Available";
  const localUsbDescription =
    pendingConnectionAction === "local_usb_picker"
      ? "Reading available Local USB choices for the exact ESP32-S3 path."
      : pendingConnectionAction === "local_usb_probe"
        ? "Probing the selected Local USB path now."
        : "Pick the exact ESP32-S3 serial path.";
  const webUsbStatusLabel = !webSerialSupported
    ? "Unavailable"
    : webUsbPickerOpen || pendingConnectionAction === "web_usb_picker"
      ? "Selecting"
      : pendingConnectionAction === "web_usb_release"
        ? "Releasing"
        : webUsbActionBusy
          ? "Reading"
          : transportMode === "web_serial"
            ? "Selected"
            : selectedWebSerialSelection
              ? "Authorized"
              : "Available";
  const webUsbDescription = webUsbPickerOpen
    ? "Finish browser device selection to continue probing."
    : pendingConnectionAction === "web_usb_release"
      ? "Removing the saved browser authorization for this device."
      : reconnectButtonBusy
        ? "Reading the currently authorized browser device."
        : selectedWebSerialSelection
          ? "Authorized device is ready. Click to choose another device."
          : "Open the browser picker immediately.";
  const releaseButtonBusy = pendingConnectionAction === "web_usb_release";
  const probeCountdownSeconds =
    probeActivity === null || probeActivity.stage === "picker"
      ? null
      : Math.max(0, Math.ceil((probeActivity.deadlineAt - probeClock) / 1000));

  const canFlash =
    !operationLocked &&
    !(
      !transportMode ||
      (sourceMode === "releases" && !selectedAsset) ||
      (sourceMode === "local_file" && !localFile) ||
      probe.kind === "idle" ||
      probe.kind === "probing" ||
      probeActivity !== null ||
      (!recoveryFlow && probe.kind !== "recognized") ||
      (transportMode === "web_serial" && selectedAsset?.fileKind === "elf") ||
      (transportMode === "web_serial" && !webSerialSupported) ||
      (sourceMode === "local_file" &&
        recoveryFlow &&
        transportMode === "local_usb")
    );
  const idleProbeSummary =
    probe.kind === "idle" && webSerialReadyForManualRead
      ? "Authorized Web USB device is ready."
      : probe.summary;
  const idleProbeDetail =
    probe.kind === "idle" && webSerialReadyForManualRead
      ? "Reconnect to read board identity, or choose another device above."
      : probe.detail;
  const targetBadgeLabel =
    probeActivity?.stage === "picker"
      ? "Waiting"
      : probeActivity
        ? "Probing"
        : probe.kind === "recognized"
          ? "Confirmed"
          : probe.kind === "non_project"
            ? "Non-project"
            : probe.kind === "probing"
              ? "Probing"
              : probe.kind === "unknown"
                ? "Unconfirmed"
                : "Waiting";
  const flashLogTitle =
    flashActivity?.title ??
    (transportMode === "web_serial" && selectedAsset?.fileKind === "elf"
      ? "Web USB cannot write this recovery image."
      : flashError
        ? "Flash failed."
        : "Flash progress appears here.");
  const flashLogDetail = flashError
    ? flashError
    : (flashActivity?.detail ??
      (transportMode === "local_usb"
        ? "Use Local USB for bundled release flashing."
        : transportMode === "web_serial" && selectedAsset?.fileKind === "elf"
          ? "Selected recovery release is bundled as ELF. Use Local USB for desktop-assisted flashing."
          : transportMode === "web_serial"
            ? "Use Web USB when browser serial access is preferred."
            : "Choose a transport, probe the target, then flash firmware."));
  const flashLogStatus =
    flashError !== null
      ? "error"
      : (flashActivity?.status ??
        (flashBusy ? "working" : ("idle" as FlashActivityStatus)));
  const targetAction =
    probeActivity !== null ? null : webSerialReadyForManualRead ? (
      <button
        className={`${outlineButtonClass} min-h-11 w-full gap-2`}
        type="button"
        disabled={operationLocked}
        onClick={() => void readAuthorizedWebUsb()}
      >
        {reconnectButtonBusy ? (
          <ReconnectIcon className="h-4 w-4 animate-spin" />
        ) : (
          <ReconnectIcon />
        )}
        <span>
          {reconnectButtonBusy ? "Reading device info…" : "Reconnect"}
        </span>
      </button>
    ) : null;
  const targetRows = [
    {
      label: "MCU",
      value: probe.hardware
        ? boardValue(
            probe.hardware.mcuModel ?? probe.hardware.chipType,
            "Unknown",
          )
        : undefined,
    },
    {
      label: "Flash",
      value: probe.hardware
        ? boardValue(probe.hardware.flashSize, "Not reported")
        : undefined,
    },
    {
      label: "RAM",
      value: probe.hardware
        ? boardValue(probe.hardware.ramSize, "Not reported")
        : undefined,
    },
    {
      label: "PSRAM",
      value: probe.hardware
        ? boardValue(probe.hardware.psramSize, "Not detected")
        : undefined,
    },
    { label: "device_id", value: probe.deviceId, mono: true },
    {
      label: "MAC",
      value: probe.hardware?.macAddress ?? probe.mac,
      mono: true,
    },
    { label: "Hostname", value: probe.hostname, mono: true },
    { label: "IPv4", value: probe.wifiIpv4, mono: true },
    {
      label: "Firmware",
      value:
        probe.kind === "recognized"
          ? [probe.firmwareName, probe.firmwareVersion]
              .filter(Boolean)
              .join(" ")
          : probe.kind === "non_project"
            ? [probe.firmwareName, probe.firmwareVersion]
                .filter(Boolean)
                .join(" ")
            : undefined,
      mono: true,
    },
    {
      label: "Name",
      value: probe.kind === "recognized" ? probe.customHardwareName : undefined,
    },
  ].filter((row) => Boolean(row.value));
  const showTargetRows = probeActivity === null && targetRows.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="firmware-flash-page">
      <div>
        <div className="text-[24px] font-bold">Firmware flash</div>
        <div className="mt-1.5 max-w-[68ch] text-[13px] font-semibold leading-6 text-[var(--muted)]">
          Standalone USB flashing surface for first-time provisioning, recovery,
          and manual release install.
        </div>
        {currentDevice ? (
          <div className="mt-1.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
            Device context:{" "}
            <span className="text-[var(--text)]">
              {currentDevice.name} • {currentDevice.id}
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cardClassName()}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[18px] font-bold">Connection</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  Choose one USB transport first, then the page probes the board
                  and enables flashing.
                </div>
              </div>
              <div className="inline-flex h-10 shrink-0 items-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-5 text-[12px] font-bold text-[var(--muted)]">
                Two USB choices
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div>
                <TransportChoiceCard
                  title="USB device"
                  status={localUsbStatusLabel}
                  description={localUsbDescription}
                  selectionSummary={
                    transportMode === "local_usb" && selectedLocalUsbPort
                      ? (selectedLocalUsbPortInfo?.label ??
                        "Exact serial path selected")
                      : undefined
                  }
                  selectionDetail={
                    transportMode === "local_usb" && selectedLocalUsbPort
                      ? selectedLocalUsbPort
                      : undefined
                  }
                  busy={localUsbActionBusy}
                  disabled={operationLocked}
                  onClick={() => void openLocalUsbPicker()}
                />
              </div>
              <div>
                <TransportChoiceCard
                  title="Web USB"
                  status={webUsbStatusLabel}
                  description={webUsbDescription}
                  selectionSummary={selectedWebSerialSelection?.summary}
                  selectionDetail={selectedWebSerialSelection?.detail}
                  selectionActions={
                    selectedWebSerialSelection ? (
                      <>
                        {webSerialReadyForManualRead ? (
                          <button
                            aria-label="Reconnect device"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
                            title="Reconnect device"
                            type="button"
                            disabled={operationLocked}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void readAuthorizedWebUsb();
                            }}
                          >
                            <ReconnectIcon
                              className={
                                reconnectButtonBusy
                                  ? "h-4 w-4 animate-spin"
                                  : "h-4 w-4"
                              }
                            />
                          </button>
                        ) : null}
                        <button
                          aria-label="Release Web USB authorization"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]"
                          title="Release Web USB authorization"
                          type="button"
                          disabled={operationLocked}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void releaseAuthorizedWebUsb();
                          }}
                        >
                          <RemoveIcon
                            className={
                              releaseButtonBusy
                                ? "h-4 w-4 animate-pulse"
                                : "h-4 w-4"
                            }
                          />
                        </button>
                      </>
                    ) : null
                  }
                  busy={webUsbActionBusy}
                  disabled={operationLocked || !webSerialSupported}
                  onMouseDownActivate={() => void openWebUsbPicker()}
                  onClick={() => void openWebUsbPicker()}
                />
              </div>
            </div>
          </section>

          <section className={cardClassName()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[18px] font-bold">Target</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  After the USB path is ready, the page probes the board and
                  shows identity plus confirmation here.
                </div>
              </div>
              <div
                className={[
                  "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]",
                  probeToneClass(probeActivity ? "probing" : probe.kind),
                ].join(" ")}
              >
                {targetBadgeLabel}
              </div>
            </div>

            {showTargetRows ? (
              <dl className="mt-3 grid gap-x-5 gap-y-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {targetRows.map((row) => (
                  <TargetInfoCell
                    key={row.label}
                    label={row.label}
                    value={String(row.value)}
                    mono={row.mono}
                  />
                ))}
              </dl>
            ) : (
              <FirmwareFlashTargetState
                title={probeActivity?.title ?? idleProbeSummary}
                detail={probeActivity?.detail ?? idleProbeDetail}
                countdownSeconds={probeCountdownSeconds}
                busy={probeActivity !== null}
                action={targetAction}
                countdownEmphasis={probeActivity ? "aside" : "inline"}
              />
            )}
          </section>

          <section className={cardClassName()}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-[18px] font-bold">Firmware source</div>
                <div className="mt-1 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                  Bundled release first. Local file only when needed.
                </div>
              </div>
              <div className="flex h-10 rounded-[14px] border border-[var(--border)] p-1">
                {(["releases", "local_file"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={[
                      "min-w-[120px] rounded-[10px] px-4 text-[12px] font-bold",
                      sourceMode === mode
                        ? "bg-[var(--primary)] text-[var(--primary-text)]"
                        : "text-[var(--text)]",
                    ].join(" ")}
                    type="button"
                    disabled={operationLocked}
                    onClick={() => setSourceMode(mode)}
                  >
                    {mode === "releases" ? "Releases" : "Local file"}
                  </button>
                ))}
              </div>
            </div>

            {sourceMode === "releases" ? (
              <div className="mt-4">
                {manifestError ? (
                  <div className="rounded-[14px] border border-[var(--error)] px-4 py-3 text-[12px] font-semibold text-[var(--error)]">
                    {manifestError}
                  </div>
                ) : (
                  <FirmwareReleaseList
                    releases={releaseChoices}
                    selectedTag={selectedReleaseTag}
                    recoveryOnly={recoveryFlow}
                    disabled={operationLocked}
                    onSelect={setSelectedReleaseTag}
                  />
                )}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
                <input
                  className="file-input file-input-sm h-12 w-full"
                  type="file"
                  accept=".bin,application/octet-stream"
                  disabled={operationLocked}
                  onChange={(event) =>
                    setLocalFile(event.currentTarget.files?.[0] ?? null)
                  }
                />
                <input
                  className="input input-sm h-12 w-full font-mono"
                  value={manualAddress}
                  disabled={operationLocked}
                  onChange={(event) => setManualAddress(event.target.value)}
                />
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <section className={cardClassName("h-full")}>
            <div className="text-[18px] font-bold">Flash</div>
            <div className="mt-1.5 text-[12px] font-semibold leading-6 text-[var(--muted)]">
              USB only. Default app address{" "}
              <span className="font-mono text-[var(--text)]">0x10000</span>.
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] p-1">
              {[
                {
                  key: "normal",
                  label: "Normal update",
                  active: !recoveryFlow,
                },
                { key: "recovery", label: "Recovery", active: recoveryFlow },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  disabled={
                    operationLocked ||
                    (targetNeedsStrongConfirmation && mode.key === "normal")
                  }
                  onClick={() => {
                    if (mode.key === "recovery") {
                      setFlashMode("recovery");
                      setFlashModeReason("manual_recovery");
                      return;
                    }
                    setFlashMode("normal");
                    setFlashModeReason("normal");
                  }}
                  className={[
                    "flex min-h-10 items-center justify-center rounded-[10px] px-3 text-[12px] font-bold transition-colors",
                    mode.active
                      ? "bg-[var(--primary)] text-[var(--primary-text)]"
                      : "text-[var(--text)] hover:bg-[var(--panel)] disabled:text-[var(--btn-disabled-text)] disabled:hover:bg-transparent",
                  ].join(" ")}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <div className="text-[14px] font-bold">Current selection</div>
              <div className="mt-2.5 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] font-semibold leading-5">
                <FlashSummaryRow label="transport" value={transportSummary} />
                <FlashSummaryRow label="mode" value={flashModeLabel} />
                <FlashSummaryRow label="source" value={selectedSourceLabel} />
                <FlashSummaryRow label="version" value={selectedVersionLabel} />
                <FlashSummaryRow label="confirm" value={confirmationLabel} />
                <FlashSummaryRow label="address" value={addressLabel} mono />
              </div>
            </div>

            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="text-[14px] font-bold">Safety check</div>
              <div className="mt-2 text-[12px] font-semibold leading-6 text-[var(--muted)]">
                {strongConfirmationRequired
                  ? "Recovery mode is active on an unconfirmed target. Strong confirmation is required before write."
                  : recoveryFlow
                    ? "Recovery mode is active for this board. Recovery-capable releases rewrite the bundled recovery image."
                    : "Normal update mode is active. App-only release images write to 0x10000."}
              </div>
            </div>

            <div className="mt-4">
              <button
                className={`${primaryButtonClass} min-h-11 w-full gap-2`}
                type="button"
                disabled={!canFlash}
                onClick={() => void onFlash()}
              >
                {flashBusy ? (
                  <>
                    <SpinnerIcon />
                    <span>
                      {recoveryFlow
                        ? "Flashing recovery..."
                        : "Flashing firmware..."}
                    </span>
                  </>
                ) : recoveryFlow ? (
                  "Flash recovery firmware"
                ) : (
                  "Flash firmware"
                )}
              </button>

              <button
                className={`${outlineButtonClass} mt-3 min-h-11 w-full`}
                type="button"
                disabled={operationLocked}
                onClick={() =>
                  currentDevice
                    ? navigate(`/devices/${currentDevice.id}/info`)
                    : navigate("/")
                }
              >
                {currentDevice ? "Back to settings" : "Back to dashboard"}
              </button>
            </div>

            <FirmwareFlashLogPanel
              title={flashLogTitle}
              detail={flashLogDetail}
              status={flashLogStatus}
              progressPercent={flashActivity?.progressPercent ?? null}
              indeterminate={flashActivity?.indeterminate ?? false}
              entries={flashLogs}
              emptyText="Detailed flash log will appear here."
            />
          </section>
        </aside>
      </div>

      <dialog
        ref={localUsbDialogRef}
        className="modal modal-bottom sm:modal-middle"
        aria-label="Choose USB device"
        onCancel={(event) => {
          event.preventDefault();
          setLocalUsbPickerOpen(false);
        }}
        onClose={() => {
          if (localUsbPickerOpen) {
            setLocalUsbPickerOpen(false);
          }
        }}
        onClick={(event) => {
          if (event.target === localUsbDialogRef.current) {
            setLocalUsbPickerOpen(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== localUsbDialogRef.current) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setLocalUsbPickerOpen(false);
          }
        }}
      >
        <div className="modal-box iso-modal flex w-full max-w-[720px] flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)] px-6 pb-6 pt-5 sm:max-w-[calc(100vw-48px)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[20px] font-bold leading-7">
                Choose USB device
              </div>
              <div className="mt-2 text-[13px] font-medium leading-6 text-[var(--muted)]">
                Pick the exact ESP32-S3 serial path, then the page probes the
                board immediately.
              </div>
            </div>
            <button
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[18px] leading-none text-[var(--muted)] transition-colors hover:text-[var(--text)]"
              type="button"
              aria-label="Close USB device picker"
              onClick={() => setLocalUsbPickerOpen(false)}
            >
              ×
            </button>
          </div>

          {localUsbPorts.length > 0 ? (
            <div className="mt-5 flex flex-col gap-3">
              {localUsbPorts.map((port) => {
                const selected = port.path === selectedLocalUsbPort;
                return (
                  <button
                    key={port.path}
                    className={[
                      "w-full rounded-[14px] border px-4 py-4 text-left transition-colors",
                      selected
                        ? "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_3%,var(--panel))]"
                        : "border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-2)]",
                    ].join(" ")}
                    type="button"
                    onClick={() => void selectLocalUsbPort(port.path)}
                  >
                    <div className="text-[14px] font-bold text-[var(--text)]">
                      {port.label}
                    </div>
                    <div className="mt-2 font-mono text-[12px] font-semibold text-[var(--muted)]">
                      {port.path}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-[14px] border border-[var(--border)] bg-[var(--panel-2)] px-4 py-4 text-[13px] font-semibold leading-6 text-[var(--muted)]">
              No Local USB device is available right now. Connect the target or
              open the desktop app, then try again.
            </div>
          )}
        </div>
      </dialog>

      {webUsbPickerOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/18 px-4 py-6"
          role="presentation"
          aria-hidden="true"
        >
          <div className="pointer-events-none w-full max-w-[360px] rounded-[18px] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
            <div className="text-[18px] font-bold text-[var(--text)]">
              Waiting for browser picker
            </div>
            <div className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]">
              Confirm the ESP32-S3 USB device in the browser dialog on the
              right. The page probes hardware immediately after selection.
            </div>
          </div>
        </div>
      ) : null}

      {strongConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          role="presentation"
        >
          <div
            className="w-full max-w-[480px] rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="flash-strong-confirm-title"
            aria-describedby="flash-strong-confirm-description"
          >
            <div
              id="flash-strong-confirm-title"
              className="text-[16px] font-bold"
            >
              Flash a target that is not confirmed as IsolaPurr?
            </div>
            <div
              id="flash-strong-confirm-description"
              className="mt-3 text-[13px] font-semibold leading-6 text-[var(--muted)]"
            >
              This recovery write may target a download-mode board, damaged
              firmware, or non-IsolaPurr hardware. Type{" "}
              <span className="font-mono text-[var(--text)]">FLASH</span> to
              continue with the selected recovery image.
            </div>
            <input
              className="input input-sm mt-4 h-11 w-full font-mono"
              value={strongConfirmText}
              onChange={(event) => setStrongConfirmText(event.target.value)}
              placeholder="Type FLASH"
            />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className={`${outlineButtonClass} min-h-11`}
                type="button"
                onClick={() => {
                  setStrongConfirmOpen(false);
                  setStrongConfirmText("");
                }}
              >
                Cancel
              </button>
              <button
                className={`${primaryButtonClass} min-h-11`}
                type="button"
                disabled={strongConfirmText.trim() !== "FLASH"}
                onClick={() => {
                  setStrongConfirmOpen(false);
                  setStrongConfirmText("");
                  void performFlash(true);
                }}
              >
                Confirm recovery flash
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
