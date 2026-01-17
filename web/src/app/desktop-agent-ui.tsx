import { createContext, useContext, useEffect, useState } from "react";
import {
  type DesktopAgent,
  tryBootstrapDesktopAgent,
} from "../domain/desktopAgent";

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
  const [agent, setAgent] = useState<DesktopAgent | null>(null);
  const [status, setStatus] = useState<DesktopAgentStatus>("loading");

  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
