const STORAGE_KEY = "isolapurr_usb_hub.flash_transport_locks";
const EVENT_NAME = "isolapurr-flash-transport-lock";
export const FLASH_TRANSPORT_LOCK_ALL = "__all__";

export type FlashTransportLock = {
  deviceId: string;
  transport: "web_serial" | null;
};

function readLocks(): Record<string, "web_serial"> {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const next: Record<string, "web_serial"> = {};
    for (const [deviceId, transport] of Object.entries(parsed)) {
      if (transport === "web_serial" && deviceId.length > 0) {
        next[deviceId] = "web_serial";
      }
    }
    return next;
  } catch {
    return {};
  }
}

function writeLocks(next: Record<string, "web_serial">): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function setFlashTransportLock({
  deviceId,
  transport,
}: FlashTransportLock): void {
  if (typeof window === "undefined" || deviceId.length === 0) {
    return;
  }
  const next = readLocks();
  if (transport === "web_serial") {
    next[deviceId] = "web_serial";
  } else {
    delete next[deviceId];
  }
  writeLocks(next);
  window.dispatchEvent(
    new CustomEvent<FlashTransportLock>(EVENT_NAME, {
      detail: { deviceId, transport },
    }),
  );
}

export function clearFlashTransportLock(deviceId: string): void {
  setFlashTransportLock({ deviceId, transport: null });
}

export function setGlobalFlashTransportLock(
  transport: "web_serial" | null,
): void {
  setFlashTransportLock({
    deviceId: FLASH_TRANSPORT_LOCK_ALL,
    transport,
  });
}

export function clearGlobalFlashTransportLock(): void {
  clearFlashTransportLock(FLASH_TRANSPORT_LOCK_ALL);
}

export function isLocalUsbSuppressedForFlashDevice(deviceId: string): boolean {
  const locks = readLocks();
  return (
    locks[FLASH_TRANSPORT_LOCK_ALL] === "web_serial" ||
    locks[deviceId] === "web_serial"
  );
}

export function subscribeFlashTransportLocks(
  callback: (lock: FlashTransportLock) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<FlashTransportLock>).detail;
    if (!detail?.deviceId) {
      return;
    }
    callback({
      deviceId: detail.deviceId,
      transport: detail.transport === "web_serial" ? "web_serial" : null,
    });
  };
  window.addEventListener(EVENT_NAME, onEvent);
  return () => window.removeEventListener(EVENT_NAME, onEvent);
}
