import type { Dispatch, MutableRefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import {
  agentFetch,
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../../domain/desktopAgent";
import { getDeviceInfo } from "../../domain/deviceApi";
import type {
  DiscoveredDevice,
  DiscoveryAction,
  DiscoverySnapshot,
} from "../../domain/discovery";
import {
  mergeDiscoveredDevice,
  parseCidr,
  parseDiscoveredDeviceFromApiInfo,
} from "../../domain/discovery";
import {
  classifyIpScanCompletion,
  createIpScanSession,
  type IpScanSession,
  saveIpScanSession,
} from "../../domain/ipScanSession";
import {
  isPersistableDesktopScan,
  isTrustedDesktopScanCompletion,
  parseDesktopDiscoverySnapshot,
  parseDesktopIpScanRunId,
} from "./AddDeviceDialog.helpers";

type ScanKind = "browser" | "desktop";

type PendingDesktopStart = {
  sessionGeneration: number;
  localRunId: number;
  agent: DesktopAgent;
  promise: Promise<void>;
  serverRunId: number | null;
  legacyAccepted: boolean;
  abortController: AbortController;
  cancelRequested: boolean;
  requestId: string;
};

export type IpScanController = {
  agentRef: MutableRefObject<DesktopAgent | null>;
  cancelActiveIpScan: () => Promise<number>;
  onRefresh: () => Promise<void>;
  onStartScan: (cidr: string) => Promise<void>;
};

type UseIpScanControllerOptions = {
  open: boolean;
  demoEnabled: boolean;
  openRef: MutableRefObject<boolean>;
  usbRunIdRef: MutableRefObject<number>;
  dispatch: Dispatch<DiscoveryAction>;
  setLastIpScanSession: (session: IpScanSession) => void;
};

export function useIpScanController({
  open,
  demoEnabled,
  openRef,
  usbRunIdRef,
  dispatch,
  setLastIpScanSession,
}: UseIpScanControllerOptions): IpScanController {
  const agentRef = useRef<DesktopAgent | null>(null);
  const agentPollRef = useRef<number | null>(null);
  const snapshotPollSequenceRef = useRef(0);
  const scanRunIdRef = useRef(0);
  const scanAbortRef = useRef<AbortController | null>(null);
  const activeScanKindRef = useRef<ScanKind | null>(null);
  const desktopScanRunIdRef = useRef<number | null>(null);
  const completedScanRunIdRef = useRef<number | null>(null);
  const scanCancellationRef = useRef(Promise.resolve());
  const pendingScanCancellationRef = useRef<{
    sessionGeneration: number;
    activeRunId: number;
    promise: Promise<number>;
  } | null>(null);
  const pendingDesktopStartRef = useRef<PendingDesktopStart | null>(null);
  const lastCancelledRunIdRef = useRef<number | null>(null);
  const commandGenerationRef = useRef(0);

  const cancelActiveIpScan = useCallback((): Promise<number> => {
    const sessionGeneration = usbRunIdRef.current;
    const activeRunId = scanRunIdRef.current;
    const desktopRunId = desktopScanRunIdRef.current;
    const agent = agentRef.current;
    const pendingStart = pendingDesktopStartRef.current;
    const pending = pendingScanCancellationRef.current;
    if (pendingStart) {
      pendingStart.cancelRequested = true;
      pendingStart.abortController.abort();
    }
    if (
      pending &&
      pending.sessionGeneration === sessionGeneration &&
      pending.activeRunId === activeRunId
    ) {
      return pending.promise;
    }
    if (
      lastCancelledRunIdRef.current === activeRunId &&
      activeScanKindRef.current === null &&
      desktopScanRunIdRef.current === null &&
      scanAbortRef.current === null &&
      pendingStart === null
    ) {
      return scanCancellationRef.current.then(() => activeRunId);
    }

    const cancelledRunId = activeRunId + 1;
    scanRunIdRef.current = cancelledRunId;
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    activeScanKindRef.current = null;
    desktopScanRunIdRef.current = null;
    completedScanRunIdRef.current = null;
    lastCancelledRunIdRef.current = cancelledRunId;
    dispatch({ type: "scan_cancelled" });

    const operation = scanCancellationRef.current
      .catch(() => undefined)
      .then(async () => {
        if (pendingStart) {
          await pendingStart.promise;
        }
        const cancellationAgent = agent ?? pendingStart?.agent ?? null;
        const cancellationRunId = desktopRunId ?? pendingStart?.serverRunId;
        const legacyCancellation =
          pendingStart?.legacyAccepted === true &&
          pendingStart.serverRunId === null;
        const cancellationRequestId =
          cancellationRunId === null && !legacyCancellation
            ? pendingStart?.requestId
            : undefined;
        if (
          cancellationAgent &&
          (cancellationRunId !== null ||
            cancellationRequestId ||
            legacyCancellation)
        ) {
          const cancellationController = new AbortController();
          const timeoutId = window.setTimeout(
            () => cancellationController.abort(),
            1_500,
          );
          try {
            await agentFetch(cancellationAgent, "/api/v1/discovery/cancel", {
              method: "POST",
              body: JSON.stringify(
                cancellationRunId !== null
                  ? { runId: cancellationRunId }
                  : cancellationRequestId
                    ? { requestId: cancellationRequestId }
                    : {},
              ),
              signal: cancellationController.signal,
            });
          } catch {
            // Cancellation is best-effort; local ownership is already invalidated.
          } finally {
            window.clearTimeout(timeoutId);
          }
        }
        return cancelledRunId;
      });
    const tracked = operation.then(
      (result) => {
        if (pendingScanCancellationRef.current?.promise === tracked) {
          pendingScanCancellationRef.current = null;
        }
        return result;
      },
      (error) => {
        if (pendingScanCancellationRef.current?.promise === tracked) {
          pendingScanCancellationRef.current = null;
        }
        throw error;
      },
    );
    pendingScanCancellationRef.current = {
      sessionGeneration,
      activeRunId,
      promise: tracked,
    };
    scanCancellationRef.current = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }, [dispatch, usbRunIdRef]);

  const onRefresh = useCallback(async () => {
    const commandGeneration = ++commandGenerationRef.current;
    const sessionGeneration = usbRunIdRef.current;
    const cancelledRunId = await cancelActiveIpScan();
    if (
      !openRef.current ||
      usbRunIdRef.current !== sessionGeneration ||
      scanRunIdRef.current !== cancelledRunId ||
      commandGenerationRef.current !== commandGeneration
    ) {
      return;
    }
    const agent = agentRef.current;
    if (!agent) {
      dispatch({ type: "reset", status: "unavailable" });
      return;
    }
    dispatch({ type: "reset", status: "scanning" });
    try {
      await agentFetch(agent, "/api/v1/discovery/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      if (
        agentRef.current === agent &&
        openRef.current &&
        usbRunIdRef.current === sessionGeneration &&
        scanRunIdRef.current === cancelledRunId &&
        commandGenerationRef.current === commandGeneration
      ) {
        dispatch({ type: "set_error", error: "Desktop agent unavailable." });
      }
    }
  }, [cancelActiveIpScan, dispatch, openRef, usbRunIdRef]);

  const onStartScan = useCallback(
    async (cidr: string) => {
      const sessionGeneration = usbRunIdRef.current;
      const parsed = parseCidr(cidr);
      if (!parsed.ok) {
        dispatch({ type: "set_error", error: parsed.error });
        return;
      }

      const commandGeneration = ++commandGenerationRef.current;
      const runId = await cancelActiveIpScan();
      if (
        !openRef.current ||
        usbRunIdRef.current !== sessionGeneration ||
        scanRunIdRef.current !== runId ||
        commandGenerationRef.current !== commandGeneration
      ) {
        return;
      }
      const agent = agentRef.current;
      if (agent) {
        activeScanKindRef.current = "desktop";
        desktopScanRunIdRef.current = null;
        completedScanRunIdRef.current = null;
        dispatch({
          type: "start_scan",
          cidr: parsed.cidr,
          total: parsed.hosts.length,
          runId,
        });
        let resolveDesktopStart!: () => void;
        const desktopStartSettled = new Promise<void>((resolve) => {
          resolveDesktopStart = resolve;
        });
        const pendingStart: PendingDesktopStart = {
          sessionGeneration,
          localRunId: runId,
          agent,
          promise: desktopStartSettled,
          serverRunId: null,
          legacyAccepted: false,
          abortController: new AbortController(),
          cancelRequested: false,
          requestId: crypto.randomUUID(),
        };
        pendingDesktopStartRef.current = pendingStart;
        const startTimeoutId = window.setTimeout(
          () => pendingStart.abortController.abort(),
          10_000,
        );
        void (async () => {
          try {
            let response: Response;
            try {
              response = await agentFetch(agent, "/api/v1/discovery/ip-scan", {
                method: "POST",
                body: JSON.stringify({
                  cidr: parsed.cidr,
                  requestId: pendingStart.requestId,
                }),
                signal: pendingStart.abortController.signal,
              });
            } catch {
              if (
                scanRunIdRef.current !== runId ||
                usbRunIdRef.current !== sessionGeneration ||
                !openRef.current ||
                commandGenerationRef.current !== commandGeneration
              ) {
                return;
              }
              void cancelActiveIpScan();
              dispatch({
                type: "set_error",
                error: "Desktop agent unavailable.",
              });
              return;
            }
            if (!response.ok) {
              if (
                scanRunIdRef.current !== runId ||
                usbRunIdRef.current !== sessionGeneration ||
                !openRef.current ||
                commandGenerationRef.current !== commandGeneration
              ) {
                return;
              }
              activeScanKindRef.current = null;
              dispatch({
                type: "set_error",
                error: "Desktop IP scan could not be started.",
              });
              dispatch({ type: "scan_cancelled", runId });
              return;
            }
            const responseBody =
              response.status === 204
                ? null
                : await response.json().catch(() => null);
            const serverRunId = parseDesktopIpScanRunId(responseBody);
            const legacyAccepted =
              response.status === 204 ||
              (response.status === 202 &&
                responseBody &&
                typeof responseBody === "object" &&
                (responseBody as Record<string, unknown>).accepted === true);
            pendingStart.serverRunId = serverRunId;
            pendingStart.legacyAccepted = legacyAccepted;
            if (
              scanRunIdRef.current !== runId ||
              usbRunIdRef.current !== sessionGeneration ||
              !openRef.current ||
              commandGenerationRef.current !== commandGeneration
            ) {
              return;
            }
            if (serverRunId === null && legacyAccepted) {
              desktopScanRunIdRef.current = runId;
              return;
            }
            if (serverRunId === null) {
              activeScanKindRef.current = null;
              dispatch({
                type: "set_error",
                error: "Desktop IP scan returned no run identifier.",
              });
              dispatch({ type: "scan_cancelled", runId });
              return;
            }
            desktopScanRunIdRef.current = serverRunId;
          } finally {
            window.clearTimeout(startTimeoutId);
            resolveDesktopStart();
            if (pendingDesktopStartRef.current === pendingStart) {
              pendingDesktopStartRef.current = null;
            }
          }
        })();
        return;
      }

      activeScanKindRef.current = "browser";
      desktopScanRunIdRef.current = null;
      completedScanRunIdRef.current = null;
      const abortController = new AbortController();
      scanAbortRef.current = abortController;
      const foundDevices: DiscoveredDevice[] = [];
      dispatch({
        type: "start_scan",
        cidr: parsed.cidr,
        total: parsed.hosts.length,
        runId,
      });

      const concurrency = 12;
      let nextIndex = 0;
      let done = 0;
      let reachableResponses = 0;
      let browserBlockedRequests = 0;

      const worker = async () => {
        for (;;) {
          if (
            scanRunIdRef.current !== runId ||
            usbRunIdRef.current !== sessionGeneration ||
            !openRef.current ||
            commandGenerationRef.current !== commandGeneration
          ) {
            return;
          }
          const idx = nextIndex;
          nextIndex += 1;
          if (idx >= parsed.hosts.length) {
            return;
          }

          const ip = parsed.hosts[idx];
          const baseUrlByIp = `http://${ip}`;
          const res = await getDeviceInfo(baseUrlByIp, {
            signal: abortController.signal,
          });
          if (
            scanRunIdRef.current !== runId ||
            usbRunIdRef.current !== sessionGeneration ||
            !openRef.current ||
            commandGenerationRef.current !== commandGeneration
          ) {
            return;
          }
          done += 1;
          dispatch({ type: "scan_progress", done, runId });

          if (!res.ok) {
            if (res.error.reachable) {
              reachableResponses += 1;
            }
            if (res.error.kind === "browser_blocked") {
              browserBlockedRequests += 1;
            }
            continue;
          }

          reachableResponses += 1;
          const device = parseDiscoveredDeviceFromApiInfo(
            baseUrlByIp,
            res.value as unknown,
            ip,
            new Date().toISOString(),
          );
          if (!device) {
            continue;
          }
          foundDevices.push(device);
          dispatch({ type: "scan_device", device, runId });
        }
      };

      void (async () => {
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        if (
          scanRunIdRef.current !== runId ||
          usbRunIdRef.current !== sessionGeneration ||
          !openRef.current ||
          commandGenerationRef.current !== commandGeneration
        ) {
          return;
        }
        const completion = classifyIpScanCompletion({
          reachableResponses,
          browserBlockedRequests,
        });
        if (completion === "browser_blocked") {
          dispatch({
            type: "set_error",
            error:
              "Browser blocked private-network access. Allow LAN access in the browser, or connect by USB first to verify and save the IPv4 path.",
          });
        }
        dispatch({ type: "scan_done", runId });
        activeScanKindRef.current = null;
        scanAbortRef.current = null;
        if (completion === "completed") {
          const session = createIpScanSession(parsed.cidr, foundDevices);
          saveIpScanSession(demoEnabled, session);
          setLastIpScanSession(session);
        }
      })();
    },
    [
      cancelActiveIpScan,
      demoEnabled,
      dispatch,
      openRef,
      setLastIpScanSession,
      usbRunIdRef,
    ],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const agent = await tryBootstrapDesktopAgent();
      if (cancelled || !openRef.current) {
        return;
      }
      agentRef.current = agent;
      if (!agent) {
        dispatch({ type: "reset", status: "unavailable", preserveScan: true });
        return;
      }

      dispatch({ type: "reset", status: "scanning", preserveScan: true });
      try {
        await agentFetch(agent, "/api/v1/discovery/refresh", {
          method: "POST",
          body: JSON.stringify({}),
        });
      } catch {
        if (!cancelled && openRef.current && agentRef.current === agent) {
          dispatch({ type: "set_error", error: "Desktop agent unavailable." });
        }
        return;
      }
      if (cancelled || !openRef.current) {
        return;
      }

      if (agentPollRef.current) {
        window.clearInterval(agentPollRef.current);
      }
      agentPollRef.current = window.setInterval(() => {
        void (async () => {
          const current = agentRef.current;
          if (!current || !openRef.current || cancelled) {
            return;
          }
          const pollGeneration = scanRunIdRef.current;
          const pollCommandGeneration = commandGenerationRef.current;
          const pollSequence = ++snapshotPollSequenceRef.current;
          let res: Response;
          try {
            res = await agentFetch(current, "/api/v1/discovery/snapshot", {});
          } catch {
            if (
              current !== agentRef.current ||
              !openRef.current ||
              scanRunIdRef.current !== pollGeneration ||
              pollSequence !== snapshotPollSequenceRef.current ||
              commandGenerationRef.current !== pollCommandGeneration
            ) {
              return;
            }
            if (activeScanKindRef.current === "desktop") {
              void cancelActiveIpScan();
            }
            dispatch({
              type: "set_error",
              error: "Desktop agent unavailable.",
            });
            return;
          }
          if (
            current !== agentRef.current ||
            !openRef.current ||
            scanRunIdRef.current !== pollGeneration ||
            pollSequence !== snapshotPollSequenceRef.current ||
            commandGenerationRef.current !== pollCommandGeneration
          ) {
            return;
          }
          if (!res.ok) {
            if (activeScanKindRef.current === "desktop") {
              void cancelActiveIpScan();
            }
            dispatch({
              type: "set_error",
              error:
                res.status === 401 || res.status === 403
                  ? "Desktop agent authorization failed."
                  : "Desktop agent unavailable.",
            });
            return;
          }
          let value: unknown;
          try {
            value = (await res.json()) as unknown;
          } catch {
            if (
              current !== agentRef.current ||
              !openRef.current ||
              scanRunIdRef.current !== pollGeneration ||
              pollSequence !== snapshotPollSequenceRef.current ||
              commandGenerationRef.current !== pollCommandGeneration
            ) {
              return;
            }
            if (activeScanKindRef.current === "desktop") {
              void cancelActiveIpScan();
            }
            dispatch({
              type: "set_error",
              error: "Desktop agent returned invalid data.",
            });
            return;
          }
          if (
            current !== agentRef.current ||
            !openRef.current ||
            scanRunIdRef.current !== pollGeneration ||
            pollSequence !== snapshotPollSequenceRef.current ||
            commandGenerationRef.current !== pollCommandGeneration
          ) {
            return;
          }
          const parsed = parseDesktopDiscoverySnapshot(value);
          if (!parsed) {
            return;
          }
          let merged: DiscoveredDevice[] = [];
          for (const device of parsed.devices) {
            merged = mergeDiscoveredDevice(merged, device);
          }

          const scanRunId = parsed.scan?.runId;
          const ownsScan =
            activeScanKindRef.current === "desktop" &&
            parsed.scan &&
            ((scanRunId !== undefined &&
              scanRunId === desktopScanRunIdRef.current) ||
              (scanRunId === undefined &&
                desktopScanRunIdRef.current === scanRunIdRef.current));
          const ownedScan = ownsScan ? parsed.scan : undefined;
          const pendingDesktopStart = pendingDesktopStartRef.current;
          const preservingPendingDesktopStart =
            activeScanKindRef.current === "desktop" &&
            pendingDesktopStart?.localRunId === pollGeneration;
          const ownedScanRunId =
            ownedScan?.runId ?? desktopScanRunIdRef.current;
          if (
            ownedScan &&
            isTrustedDesktopScanCompletion(ownedScan) &&
            ownedScanRunId !== null &&
            completedScanRunIdRef.current !== ownedScanRunId
          ) {
            completedScanRunIdRef.current = ownedScanRunId;
            if (isPersistableDesktopScan(ownedScan)) {
              const session = createIpScanSession(
                ownedScan.cidr,
                ownedScan.devices,
              );
              saveIpScanSession(demoEnabled, session);
              setLastIpScanSession(session);
            }
          }
          dispatch({
            type: "set_snapshot",
            snapshot: {
              mode: parsed.mode,
              status: parsed.status,
              devices: merged,
              error: parsed.error,
              scan: ownedScan,
              ipScan: parsed.ipScan,
            } satisfies DiscoverySnapshot,
            replaceScan:
              activeScanKindRef.current === "desktop" &&
              !preservingPendingDesktopStart,
          });
        })();
      }, 1000);
    })();

    return () => {
      cancelled = true;
      if (agentPollRef.current) {
        window.clearInterval(agentPollRef.current);
        agentPollRef.current = null;
      }
    };
  }, [
    cancelActiveIpScan,
    demoEnabled,
    dispatch,
    open,
    openRef,
    setLastIpScanSession,
  ]);

  return { agentRef, cancelActiveIpScan, onRefresh, onStartScan };
}
