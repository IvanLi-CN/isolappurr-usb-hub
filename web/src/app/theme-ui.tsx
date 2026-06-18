import { createContext, useContext, useEffect, useState } from "react";
import { fetchStoredTheme, updateStoredTheme } from "../domain/desktopStorage";
import { DEMO_RESET_EVENT } from "./demo-mode";
import { useDesktopAgent } from "./desktop-agent-ui";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemeId,
} from "./theme";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (next: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { agent, status } = useDesktopAgent();
  const [theme, setTheme] = useState<ThemeId>("isolapurr");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    let cancelled = false;
    const loadTheme = async () => {
      if (agent) {
        const res = await fetchStoredTheme(agent);
        if (!cancelled && res.ok) {
          setTheme(res.value);
        }
      } else {
        setTheme(loadThemePreference());
      }
      if (!cancelled) {
        setReady(true);
      }
    };
    void loadTheme();
    return () => {
      cancelled = true;
    };
  }, [agent, status]);

  useEffect(() => {
    if (!agent) {
      return;
    }
    const onMigrated = () => {
      void (async () => {
        const res = await fetchStoredTheme(agent);
        if (res.ok) {
          setTheme(res.value);
        }
      })();
    };
    window.addEventListener("isolapurr-storage-migrated", onMigrated);
    return () => {
      window.removeEventListener("isolapurr-storage-migrated", onMigrated);
    };
  }, [agent]);

  useEffect(() => {
    const reloadTheme = () => {
      if (status !== "ready") {
        return;
      }
      void (async () => {
        if (agent) {
          const res = await fetchStoredTheme(agent);
          if (res.ok) {
            setTheme(res.value);
          }
          return;
        }
        setTheme(loadThemePreference());
      })();
    };

    window.addEventListener(DEMO_RESET_EVENT, reloadTheme);
    return () => {
      window.removeEventListener(DEMO_RESET_EVENT, reloadTheme);
    };
  }, [agent, status]);

  useEffect(() => {
    applyThemePreference(theme);
    if (!ready) {
      return;
    }
    if (agent) {
      void updateStoredTheme(agent, theme);
      return;
    }
    saveThemePreference(theme);
  }, [theme, agent, ready]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
