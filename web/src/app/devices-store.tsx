import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createDemoDesktopAgent,
  isDemoDesktopAgent,
} from "../domain/desktopAgent";
import {
  deleteStoredDevice,
  exportStorage,
  fetchStoredDevices,
  migrateFromLocalStorage,
  updateStoredDeviceNameCache,
  upsertStoredDevice,
} from "../domain/desktopStorage";
import type { DeviceNameCache } from "../domain/deviceName";
import type {
  AddDeviceInput,
  AddDeviceValidationResult,
  StoredDevice,
} from "../domain/devices";
import {
  DEVICES_STORAGE_KEY,
  loadStoredDevices,
  mergeStoredDeviceTransports,
  normalizeBaseUrl,
  preferVerifiedHttpBaseUrl,
  saveStoredDevices,
  validateAddDeviceDraftInput,
  validateAddDeviceInput,
} from "../domain/devices";
import { forgetLocalUsbDeviceLink } from "../domain/localUsbLinks";
import { forgetWebSerialDeviceTransport } from "../domain/webSerialLinks";
import { useToast } from "../ui/toast/ToastProvider";
import { DEMO_RESET_EVENT, useDemoMode } from "./demo-mode";
import { useDesktopAgent } from "./desktop-agent-ui";
import { readMigrationPayload } from "./storage-migration";

type DevicesContextValue = {
  devices: StoredDevice[];
  addDevice: (input: AddDeviceInput) => Promise<AddDeviceValidationResult>;
  upsertDevice: (input: AddDeviceInput) => Promise<AddDeviceValidationResult>;
  rebindHttpBaseUrl: (deviceId: string, httpBaseUrl: string) => Promise<void>;
  updateDeviceNameCache: (
    deviceId: string,
    cache: DeviceNameCache,
    hostname?: string,
  ) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  getDevice: (deviceId: string) => StoredDevice | undefined;
};

const DevicesContext = createContext<DevicesContextValue | null>(null);

type DeviceStateSource = "provided" | "browser" | "desktop" | "demo";

const DEVICE_PROFILE_SYNC_CHANNEL = "isolapurr-device-profiles.v1";
const DEVICE_PROFILE_SYNC_STORAGE_KEY = "isolapurr-device-profiles.sync.v1";

export function DevicesProvider({
  children,
  initialDevices,
}: {
  children: React.ReactNode;
  initialDevices?: StoredDevice[];
}) {
  const { agent, status } = useDesktopAgent();
  const { enabled: demoEnabled } = useDemoMode();
  const { pushToast } = useToast();
  const warnedRef = useRef(false);
  const [devices, setDevices] = useState<StoredDevice[]>(() =>
    initialDevices ? initialDevices : loadStoredDevices(),
  );
  const [source, setSource] = useState<DeviceStateSource>(() =>
    initialDevices ? "provided" : "browser",
  );
  const [ready, setReady] = useState(false);
  const profileSyncTabId = useRef(
    `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const profileSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const migrationAttemptedRef = useRef(false);

  useEffect(() => {
    if (!ready || status !== "ready" || source !== "browser") {
      return;
    }
    if (agent) {
      return;
    }
    saveStoredDevices(devices);
  }, [devices, agent, ready, source, status]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      status !== "ready" ||
      agent ||
      source !== "browser"
    ) {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== DEVICES_STORAGE_KEY) {
        return;
      }
      setDevices(loadStoredDevices());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [agent, source, status]);

  useEffect(() => {
    if (typeof window === "undefined" || status !== "ready" || !agent) {
      return;
    }
    const refreshFromDesktop = () => {
      void fetchStoredDevices(agent).then((res) => {
        if (!res.ok) {
          return;
        }
        setDevices(res.value);
        setSource(isDemoDesktopAgent(agent) ? "demo" : "desktop");
      });
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEVICE_PROFILE_SYNC_STORAGE_KEY) {
        return;
      }
      refreshFromDesktop();
    };
    window.addEventListener("storage", handleStorage);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(DEVICE_PROFILE_SYNC_CHANNEL);
    if (channel) {
      profileSyncChannelRef.current = channel;
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data as { sourceTabId?: unknown };
        if (message?.sourceTabId === profileSyncTabId.current) {
          return;
        }
        refreshFromDesktop();
      };
    }
    return () => {
      window.removeEventListener("storage", handleStorage);
      channel?.close();
      if (profileSyncChannelRef.current === channel) {
        profileSyncChannelRef.current = null;
      }
    };
  }, [agent, status]);

  const broadcastProfileSync = useCallback(() => {
    const message = { sourceTabId: profileSyncTabId.current };
    profileSyncChannelRef.current?.postMessage(message);
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        DEVICE_PROFILE_SYNC_STORAGE_KEY,
        JSON.stringify({ ...message, at: Date.now() }),
      );
    } catch {
      // Desktop storage remains authoritative when localStorage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    let cancelled = false;
    void (async () => {
      if (agent) {
        const res = await fetchStoredDevices(agent);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          pushToast({
            variant: "error",
            message: `Desktop storage unavailable: ${res.error.message}`,
          });
        } else {
          setDevices(res.value);
          setSource(isDemoDesktopAgent(agent) ? "demo" : "desktop");
        }
      } else if (!initialDevices) {
        setDevices(loadStoredDevices());
        setSource("browser");
      } else {
        setSource("provided");
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, status, pushToast, initialDevices]);

  useEffect(() => {
    if (!demoEnabled) {
      return;
    }

    const syncDemoDevices = () => {
      const demoAgent =
        agent && isDemoDesktopAgent(agent) ? agent : createDemoDesktopAgent();
      void (async () => {
        const res = await fetchStoredDevices(demoAgent);
        if (!res.ok) {
          return;
        }
        setDevices(res.value);
        setSource("demo");
      })();
    };

    window.addEventListener(DEMO_RESET_EVENT, syncDemoDevices);
    return () => {
      window.removeEventListener(DEMO_RESET_EVENT, syncDemoDevices);
    };
  }, [agent, demoEnabled]);

  useEffect(() => {
    if (
      status !== "ready" ||
      !agent ||
      isDemoDesktopAgent(agent) ||
      migrationAttemptedRef.current
    ) {
      return;
    }
    migrationAttemptedRef.current = true;
    void (async () => {
      const existing = await fetchStoredDevices(agent);
      if (!existing.ok || existing.value.length > 0) {
        return;
      }
      const payload = readMigrationPayload();
      if (!payload) {
        return;
      }
      const res = await migrateFromLocalStorage(agent, payload);
      if (!res.ok) {
        return;
      }
      if (res.value.migrated) {
        pushToast({
          variant: "success",
          message: "Imported devices/settings from browser storage.",
        });
        window.dispatchEvent(new CustomEvent("isolapurr-storage-migrated"));
      }
      // Another tab may have won the one-shot migration while this tab was
      // reading the empty registry; refresh in either response case.
      const refreshed = await fetchStoredDevices(agent);
      if (refreshed.ok) {
        setDevices(refreshed.value);
      }
    })();
  }, [agent, status, pushToast]);

  useEffect(() => {
    if (
      status !== "ready" ||
      !agent ||
      warnedRef.current ||
      isDemoDesktopAgent(agent)
    ) {
      return;
    }
    void (async () => {
      const res = await exportStorage(agent);
      if (!res.ok) {
        return;
      }
      const meta = res.value.meta;
      if (meta?.last_corrupt_at) {
        warnedRef.current = true;
        pushToast({
          variant: "warning",
          message: "Local storage was reset after a corruption.",
        });
      }
    })();
  }, [agent, status, pushToast]);

  const value = useMemo<DevicesContextValue>(() => {
    const existingIds = new Set(devices.map((d) => d.id));
    const existingBaseUrls = new Set(devices.map((d) => d.baseUrl));

    const persistDevice = async (
      device: StoredDevice,
    ): Promise<AddDeviceValidationResult> => {
      if (!agent) {
        setDevices((prev) => {
          const next = prev.filter(
            (d) => d.id !== device.id && d.baseUrl !== device.baseUrl,
          );
          return [...next, device];
        });
        return { ok: true, device };
      }
      const res = await upsertStoredDevice(agent, device);
      if (!res.ok) {
        if (res.error.code === "conflict") {
          return {
            ok: false,
            errors: { baseUrl: res.error.message },
          };
        }
        pushToast({
          variant: "error",
          message: `Desktop storage error: ${res.error.message}`,
        });
        return {
          ok: false,
          errors: { baseUrl: "Desktop storage unavailable" },
        };
      }
      setDevices((prev) => {
        const next = prev.filter(
          (d) => d.id !== res.value.id && d.baseUrl !== res.value.baseUrl,
        );
        return [...next, res.value];
      });
      broadcastProfileSync();
      return { ok: true, device: res.value };
    };

    return {
      devices,
      addDevice: async (input) => {
        if (demoEnabled) {
          const prepared = validateAddDeviceDraftInput(
            input,
            existingIds,
            existingBaseUrls,
            { allowMissingId: true },
          );
          if (!prepared.ok) {
            return prepared;
          }
          const res = await upsertStoredDevice(
            createDemoDesktopAgent(),
            prepared.input,
          );
          if (!res.ok) {
            if (res.error.code === "conflict") {
              return {
                ok: false,
                errors: { baseUrl: res.error.message },
              };
            }
            pushToast({
              variant: "error",
              message: `Desktop storage error: ${res.error.message}`,
            });
            return {
              ok: false,
              errors: { baseUrl: "Desktop storage unavailable" },
            };
          }
          setDevices((prev) => {
            const next = prev.filter(
              (device) =>
                device.id !== res.value.id &&
                device.baseUrl !== res.value.baseUrl,
            );
            return [...next, res.value];
          });
          broadcastProfileSync();
          return { ok: true, device: res.value };
        }

        const result = validateAddDeviceInput(
          input,
          existingIds,
          existingBaseUrls,
        );
        if (!result.ok) {
          return result;
        }
        return persistDevice(result.device);
      },
      upsertDevice: async (input) => {
        const name = input.name.trim();
        const id = input.id?.trim();
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        if (!name || !id || !baseUrl.ok) {
          return {
            ok: false,
            errors: {
              name: name ? undefined : "Name is required",
              id: id ? undefined : "ID is required",
              baseUrl: baseUrl.ok ? undefined : baseUrl.error,
            },
          };
        }
        if (devices.some((d) => d.id !== id && d.baseUrl === baseUrl.baseUrl)) {
          return { ok: false, errors: { baseUrl: "Base URL already exists" } };
        }
        const existing = devices.find((d) => d.id === id);
        return persistDevice({
          id,
          name,
          baseUrl: baseUrl.baseUrl,
          deviceNameCache: existing?.deviceNameCache,
          transports: mergeStoredDeviceTransports(
            existing?.transports,
            input.transports,
          ),
        });
      },
      updateDeviceNameCache: async (deviceId, cache, hostname) => {
        const existing = devices.find((device) => device.id === deviceId);
        if (!existing) {
          return;
        }
        const current = existing.deviceNameCache;
        const nextHostname = hostname?.trim() || existing.hostname;
        if (
          current?.state === cache.state &&
          (cache.state !== "value" ||
            (current.state === "value" && current.value === cache.value)) &&
          nextHostname === existing.hostname
        ) {
          return;
        }
        if (agent) {
          const res = await updateStoredDeviceNameCache(agent, deviceId, {
            hostname: nextHostname,
            deviceNameCache: cache,
          });
          if (!res.ok) {
            pushToast({
              variant: "error",
              message: `Desktop storage error: ${res.error.message}`,
            });
            return;
          }
          setDevices((prev) => {
            const next = prev.filter(
              (d) => d.id !== res.value.id && d.baseUrl !== res.value.baseUrl,
            );
            return [...next, res.value];
          });
          broadcastProfileSync();
          return;
        }
        const latest = loadStoredDevices().find(
          (device) => device.id === deviceId,
        );
        const next = latest ?? existing;
        await persistDevice({
          ...next,
          hostname: nextHostname,
          deviceNameCache: cache,
        });
      },
      rebindHttpBaseUrl: async (deviceId, httpBaseUrl) => {
        const existing = devices.find((device) => device.id === deviceId);
        if (!existing) {
          return;
        }
        const next = preferVerifiedHttpBaseUrl(existing, httpBaseUrl);
        if (
          next.baseUrl === existing.baseUrl &&
          next.transports?.httpBaseUrl === existing.transports?.httpBaseUrl
        ) {
          return;
        }
        await persistDevice(next);
      },
      removeDevice: async (deviceId) => {
        if (agent) {
          const res = await deleteStoredDevice(agent, deviceId);
          if (!res.ok) {
            pushToast({
              variant: "error",
              message: `Desktop storage error: ${res.error.message}`,
            });
            throw new Error(res.error.message);
          }
        }
        forgetLocalUsbDeviceLink(deviceId);
        forgetWebSerialDeviceTransport(deviceId);
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
        broadcastProfileSync();
      },
      getDevice: (deviceId) => devices.find((d) => d.id === deviceId),
    };
  }, [devices, agent, demoEnabled, pushToast, broadcastProfileSync]);

  return (
    <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
  );
}

export function useDevices(): DevicesContextValue {
  const ctx = useContext(DevicesContext);
  if (!ctx) {
    throw new Error("useDevices must be used within <DevicesProvider>");
  }
  return ctx;
}
