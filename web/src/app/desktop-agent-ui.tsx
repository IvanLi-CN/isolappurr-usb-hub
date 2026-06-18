import { createContext, useContext, useEffect, useState } from "react";
import {
  createDemoDesktopAgent,
  type DesktopAgent,
  isDemoDesktopAgent,
  tryBootstrapDesktopAgent,
} from "../domain/desktopAgent";
import { useDemoMode } from "./demo-mode";

type DesktopAgentStatus = "loading" | "ready";

type DesktopAgentContextValue = {
  agent: DesktopAgent | null;
  status: DesktopAgentStatus;
};

const DesktopAgentContext = createContext<DesktopAgentContextValue | null>(
  null,
);

export function DesktopAgentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled: demoEnabled } = useDemoMode();
  const [agent, setAgent] = useState<DesktopAgent | null>(() =>
    demoEnabled ? createDemoDesktopAgent() : null,
  );
  const [status, setStatus] = useState<DesktopAgentStatus>(() =>
    demoEnabled ? "ready" : "loading",
  );

  useEffect(() => {
    if (demoEnabled) {
      setAgent((current) =>
        isDemoDesktopAgent(current) ? current : createDemoDesktopAgent(),
      );
      setStatus("ready");
      return () => undefined;
    }

    let cancelled = false;
    setAgent(null);
    setStatus("loading");
    void (async () => {
      const next = await tryBootstrapDesktopAgent();
      if (cancelled) {
        return;
      }
      setAgent(next);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [demoEnabled]);

  return (
    <DesktopAgentContext.Provider value={{ agent, status }}>
      {children}
    </DesktopAgentContext.Provider>
  );
}

export function useDesktopAgent(): DesktopAgentContextValue {
  const ctx = useContext(DesktopAgentContext);
  if (!ctx) {
    throw new Error(
      "useDesktopAgent must be used within <DesktopAgentProvider>",
    );
  }
  return ctx;
}
