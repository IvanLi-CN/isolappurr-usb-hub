import { useEffect } from "react";

type PwaBootShellApi = {
  markAppMounted: () => void;
  reportStartupFailure: (detail?: unknown) => void;
};

declare global {
  interface Window {
    __ISOLAPURR_PWA_BOOT__?: PwaBootShellApi;
  }
}

function getBootShell(): PwaBootShellApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.__ISOLAPURR_PWA_BOOT__;
}

export function markPwaBootMounted(): void {
  getBootShell()?.markAppMounted();
}

export function reportPwaStartupFailure(detail?: unknown): void {
  getBootShell()?.reportStartupFailure(detail);
}

export function PwaBootMountSignal() {
  useEffect(() => {
    markPwaBootMounted();
  }, []);

  return null;
}
