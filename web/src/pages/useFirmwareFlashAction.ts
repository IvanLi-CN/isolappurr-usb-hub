import { tryBootstrapDesktopAgent } from "../domain/desktopAgent";
import { fetchBundledFirmwareAssetFile } from "../domain/firmwareBundle";
import {
  flashBundledWithLocalUsb,
  flashWithLocalUsb,
  flashWithWebSerial,
  refreshGrantedWebSerialPort,
} from "../domain/hardwareConsole";
import {
  delayMs,
  describeFlashProgress,
  normalizeFirmwareVersion,
  updateProbeVersion,
} from "./firmwareFlashShared";
import type { FirmwareFlashConnection } from "./useFirmwareFlashConnection";

export function useFirmwareFlashAction(
  connection: FirmwareFlashConnection,
  demoEnabled: boolean,
) {
  const {
    appendFlashLog,
    appendFlashLogLines,
    clearPseudoFlashProgress,
    expectedIdentity,
    flashLogSerialRef,
    flashOperationStartedAtRef,
    localFile,
    manualAddress,
    probe,
    pseudoFlashProgressTimerRef,
    recoveryFlow,
    refreshProbeAfterFlash,
    selectedAsset,
    selectedLocalUsbPort,
    selectedRelease,
    selectedWebSerialPortRef,
    setFlashActivity,
    setFlashBusy,
    setFlashError,
    setFlashLogs,
    setProbe,
    setStrongConfirmOpen,
    sourceMode,
    strongConfirmationRequired,
    transportMode,
  } = connection;

  const performFlash = async (confirmNonProjectFirmware: boolean) => {
    const resetFlashRun = () => {
      clearPseudoFlashProgress();
      flashOperationStartedAtRef.current = Date.now();
      flashLogSerialRef.current = 0;
      setFlashLogs([]);
      setFlashActivity({
        status: "working",
        title: "Preparing firmware write…",
        detail: "Validating the selected transport and firmware source.",
        progressPercent: 4,
        indeterminate: true,
      });
    };

    const beginBridgeProgress = (title: string, detail: string) => {
      clearPseudoFlashProgress();
      setFlashActivity({
        status: "working",
        title,
        detail,
        progressPercent: 18,
        indeterminate: false,
      });
      pseudoFlashProgressTimerRef.current = window.setInterval(() => {
        setFlashActivity((current) => {
          if (!current || current.status !== "working") {
            return current;
          }
          return {
            ...current,
            progressPercent: Math.min(
              82,
              Math.max(18, (current.progressPercent ?? 18) + 4),
            ),
          };
        });
      }, 700);
    };

    const runDemoFlash = async (
      selectionLabel: string,
      flashedVersion: string | null,
    ) => {
      setFlashActivity({
        status: "working",
        title: "Preparing demo flash…",
        detail: `Loading ${selectionLabel} for a simulated flash session.`,
        progressPercent: 12,
        indeterminate: false,
      });
      await delayMs(380);
      appendFlashLog(`Demo asset ready: ${selectionLabel}.`);
      if (transportMode === "local_usb") {
        beginBridgeProgress(
          "Writing through Local USB bridge…",
          "Demo bridge is replaying the selected flash sequence.",
        );
      } else {
        setFlashActivity({
          status: "working",
          title: "Writing firmware over Web Serial…",
          detail: "Demo transport is replaying browser-side flash progress.",
          progressPercent: 28,
          indeterminate: false,
        });
      }
      for (const percent of [32, 49, 66, 81, 93]) {
        await delayMs(340);
        setFlashActivity({
          status: "working",
          title:
            transportMode === "local_usb"
              ? "Writing through Local USB bridge…"
              : "Writing firmware over Web Serial…",
          detail:
            transportMode === "local_usb"
              ? "Demo bridge is replaying the selected flash sequence."
              : "Demo transport is replaying browser-side flash progress.",
          progressPercent: percent,
          indeterminate: false,
        });
        appendFlashLog(
          percent >= 90
            ? "Verifying the flashed image and rebooting the target."
            : `Programming flash blocks… ${percent}%`,
        );
      }
      clearPseudoFlashProgress();
      setFlashActivity({
        status: "working",
        title: "Refreshing target identity…",
        detail: "Demo target is rebooting to confirm the flashed firmware.",
        progressPercent: 97,
        indeterminate: false,
      });
      await delayMs(480);
      setProbe((current) => updateProbeVersion(current, flashedVersion));
      appendFlashLog(
        flashedVersion
          ? `Demo target now reports firmware ${flashedVersion}.`
          : "Demo flash sequence completed.",
        "success",
      );
      setFlashActivity({
        status: "success",
        title: "Demo flash completed.",
        detail: "Demo target identity was refreshed successfully.",
        progressPercent: 100,
        indeterminate: false,
      });
    };

    setFlashBusy(true);
    setFlashError(null);
    resetFlashRun();
    try {
      appendFlashLog(
        recoveryFlow
          ? "Recovery mode armed for this flash session."
          : "Normal update mode armed for this flash session.",
      );
      if (sourceMode === "releases") {
        if (!selectedRelease || !selectedAsset) {
          throw new Error("Choose a bundled firmware release first.");
        }
        appendFlashLog(
          `Selected bundled release ${selectedRelease.tagName} (${selectedAsset.fileName}).`,
        );

        if (demoEnabled) {
          await runDemoFlash(
            `${selectedRelease.tagName} (${selectedAsset.fileName})`,
            normalizeFirmwareVersion(selectedRelease.version),
          );
          return;
        }

        if (transportMode === "local_usb") {
          const agent = await tryBootstrapDesktopAgent();
          if (!agent || !selectedLocalUsbPort) {
            throw new Error("Select a Local USB target first.");
          }
          setFlashActivity({
            status: "working",
            title: "Preparing bundled release…",
            detail:
              "Loading the bundled app image before handing off to Local USB.",
            progressPercent: 12,
            indeterminate: false,
          });
          await delayMs(60);
          appendFlashLog("Bundled release is ready for Local USB flashing.");
          beginBridgeProgress(
            "Writing through Local USB bridge…",
            "Desktop bridge is programming the selected ESP32-S3 target.",
          );
          const log = await flashBundledWithLocalUsb(
            agent,
            selectedLocalUsbPort,
            selectedRelease,
            selectedAsset,
            recoveryFlow,
            expectedIdentity,
            confirmNonProjectFirmware,
          );
          clearPseudoFlashProgress();
          appendFlashLogLines(log);
          setFlashActivity({
            status: "working",
            title: "Refreshing target identity…",
            detail:
              "The board is rebooting so the page can verify the flashed firmware.",
            progressPercent: 96,
            indeterminate: false,
          });
          await refreshProbeAfterFlash("local_usb").catch((err) => {
            appendFlashLog(
              err instanceof Error
                ? `Target refresh failed: ${err.message}`
                : "Target refresh failed after flash.",
              "error",
            );
          });
          appendFlashLog("Bundled release flash completed.", "success");
          setFlashActivity({
            status: "success",
            title: "Bundled release flash completed.",
            detail: "Local USB write finished and the target was re-read.",
            progressPercent: 100,
            indeterminate: false,
          });
          return;
        }
        const port = selectedWebSerialPortRef.current;
        if (!port) {
          throw new Error(
            "Open Web USB first and choose the exact ESP32-S3 target.",
          );
        }
        const refreshedPort = await refreshGrantedWebSerialPort(port);
        selectedWebSerialPortRef.current = refreshedPort;
        const file = await fetchBundledFirmwareAssetFile(selectedAsset);
        appendFlashLog("Streaming bundled release over Web Serial.");
        let lastWebSerialStage = "";
        let lastWebSerialBucket = -1;
        await flashWithWebSerial(
          refreshedPort,
          file,
          selectedAsset.flashAddress,
          (progress) => {
            setFlashActivity(describeFlashProgress(progress));
            const ratio =
              progress.total && progress.total > 0
                ? Math.round(((progress.written ?? 0) / progress.total) * 100)
                : null;
            if (
              progress.stage === "connecting" &&
              lastWebSerialStage !== "connecting"
            ) {
              lastWebSerialStage = "connecting";
              appendFlashLog(progress.message);
              return;
            }
            if (progress.stage === "done") {
              lastWebSerialStage = "done";
              appendFlashLog(progress.message, "success");
              return;
            }
            if (ratio !== null) {
              const bucket = Math.floor(ratio / 20);
              if (bucket > lastWebSerialBucket) {
                lastWebSerialBucket = bucket;
                appendFlashLog(`${progress.message} ${ratio}%`);
              }
            } else if (lastWebSerialStage !== progress.stage) {
              lastWebSerialStage = progress.stage;
              appendFlashLog(progress.message);
            }
          },
        );
        setFlashActivity({
          status: "working",
          title: "Refreshing target identity…",
          detail:
            "The browser transport finished writing. Waiting for the target to reboot.",
          progressPercent: 96,
          indeterminate: false,
        });
        await refreshProbeAfterFlash("web_serial").catch((err) => {
          appendFlashLog(
            err instanceof Error
              ? `Target refresh failed: ${err.message}`
              : "Target refresh failed after flash.",
            "error",
          );
        });
        appendFlashLog("Web Serial firmware flash completed.", "success");
        setFlashActivity({
          status: "success",
          title: "Web Serial firmware flash completed.",
          detail: "The page re-read the target after the browser-side write.",
          progressPercent: 100,
          indeterminate: false,
        });
        return;
      }

      if (!localFile) {
        throw new Error("Select a local firmware file first.");
      }
      appendFlashLog(`Selected local file ${localFile.name}.`);
      const address = Number.parseInt(manualAddress, 16);
      if (!Number.isFinite(address)) {
        throw new Error("Enter a valid hex flash address.");
      }
      if (demoEnabled) {
        await runDemoFlash(
          localFile.name,
          normalizeFirmwareVersion(probe.firmwareVersion),
        );
        return;
      }
      if (transportMode === "local_usb") {
        const agent = await tryBootstrapDesktopAgent();
        if (!agent || !selectedLocalUsbPort) {
          throw new Error("Select a Local USB target first.");
        }
        if (recoveryFlow) {
          throw new Error(
            "Local file recovery is only available over Web Serial in this workbench.",
          );
        }
        beginBridgeProgress(
          "Writing local file through Local USB bridge…",
          "Desktop bridge is programming the selected app image.",
        );
        const log = await flashWithLocalUsb(
          agent,
          selectedLocalUsbPort,
          localFile,
          address,
          expectedIdentity ?? {},
        );
        clearPseudoFlashProgress();
        appendFlashLogLines(log);
        setFlashActivity({
          status: "working",
          title: "Refreshing target identity…",
          detail:
            "The board is rebooting so the page can verify the local file write.",
          progressPercent: 96,
          indeterminate: false,
        });
        await refreshProbeAfterFlash("local_usb").catch((err) => {
          appendFlashLog(
            err instanceof Error
              ? `Target refresh failed: ${err.message}`
              : "Target refresh failed after flash.",
            "error",
          );
        });
        appendFlashLog("Local USB firmware flash completed.", "success");
        setFlashActivity({
          status: "success",
          title: "Local USB firmware flash completed.",
          detail:
            "The uploaded app image was written and the target was re-read.",
          progressPercent: 100,
          indeterminate: false,
        });
        return;
      }
      const port = selectedWebSerialPortRef.current;
      if (!port) {
        throw new Error(
          "Open Web USB first and choose the exact ESP32-S3 target.",
        );
      }
      const refreshedPort = await refreshGrantedWebSerialPort(port);
      selectedWebSerialPortRef.current = refreshedPort;
      appendFlashLog("Streaming local file over Web Serial.");
      let lastWebSerialStage = "";
      let lastWebSerialBucket = -1;
      await flashWithWebSerial(
        refreshedPort,
        localFile,
        address,
        (progress) => {
          setFlashActivity(describeFlashProgress(progress));
          const ratio =
            progress.total && progress.total > 0
              ? Math.round(((progress.written ?? 0) / progress.total) * 100)
              : null;
          if (
            progress.stage === "connecting" &&
            lastWebSerialStage !== "connecting"
          ) {
            lastWebSerialStage = "connecting";
            appendFlashLog(progress.message);
            return;
          }
          if (progress.stage === "done") {
            lastWebSerialStage = "done";
            appendFlashLog(progress.message, "success");
            return;
          }
          if (ratio !== null) {
            const bucket = Math.floor(ratio / 20);
            if (bucket > lastWebSerialBucket) {
              lastWebSerialBucket = bucket;
              appendFlashLog(`${progress.message} ${ratio}%`);
            }
          } else if (lastWebSerialStage !== progress.stage) {
            lastWebSerialStage = progress.stage;
            appendFlashLog(progress.message);
          }
        },
      );
      setFlashActivity({
        status: "working",
        title: "Refreshing target identity…",
        detail:
          "The browser transport finished writing. Waiting for the target to reboot.",
        progressPercent: 96,
        indeterminate: false,
      });
      await refreshProbeAfterFlash("web_serial").catch((err) => {
        appendFlashLog(
          err instanceof Error
            ? `Target refresh failed: ${err.message}`
            : "Target refresh failed after flash.",
          "error",
        );
      });
      appendFlashLog("Web Serial firmware flash completed.", "success");
      setFlashActivity({
        status: "success",
        title: "Web Serial firmware flash completed.",
        detail:
          "The uploaded app image was written and the target was re-read.",
        progressPercent: 100,
        indeterminate: false,
      });
    } catch (err) {
      clearPseudoFlashProgress();
      const message =
        err instanceof Error ? err.message : "Firmware flash failed.";
      setFlashError(message);
      appendFlashLog(message, "error");
      setFlashActivity((current) => ({
        status: "error",
        title: "Flash failed.",
        detail: message,
        progressPercent: current?.progressPercent ?? 0,
        indeterminate: false,
      }));
    } finally {
      clearPseudoFlashProgress();
      setFlashBusy(false);
    }
  };

  const onFlash = async () => {
    if (strongConfirmationRequired) {
      setStrongConfirmOpen(true);
      return;
    }
    await performFlash(false);
  };

  return { onFlash, performFlash };
}
