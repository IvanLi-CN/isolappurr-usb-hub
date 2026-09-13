import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  clearDemoMode,
  ensureDemoFetchInterceptor,
  initDemoMode,
  readDemoEnabled,
  withDemoSearch,
} from "./demo-mode";

const DEMO_ENTER_QUERY = "?demo=true";
const DEMO_EXIT_QUERY = "?demo=false";

type DemoModeContextValue = {
  enabled: boolean;
  query: string;
  withDemoSearch: (to: string) => string;
  exitHref: string;
  bootstrap: (pathname: string, search: string) => void;
  clear: () => void;
};

const DEMO_MODE_DISABLED: DemoModeContextValue = {
  enabled: false,
  query: "",
  withDemoSearch: (to) => to,
  exitHref: `/${DEMO_EXIT_QUERY}`,
  bootstrap: () => {},
  clear: () => {},
};

const DemoModeContext = createContext<DemoModeContextValue>(DEMO_MODE_DISABLED);

function resolveInitialDemoEnabled(): boolean {
  const enabled = initDemoMode(
    typeof window !== "undefined" ? window.location.pathname : "/",
    typeof window !== "undefined" ? window.location.search : "",
  );
  if (enabled) {
    ensureDemoFetchInterceptor();
  }
  return enabled;
}

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(resolveInitialDemoEnabled);

  useEffect(() => {
    setEnabled(readDemoEnabled());
  }, []);

  useLayoutEffect(() => {
    ensureDemoFetchInterceptor();
    return () => undefined;
  }, []);

  const value = useMemo<DemoModeContextValue>(() => {
    const query = enabled ? DEMO_ENTER_QUERY : "";
    return {
      enabled,
      query,
      withDemoSearch: (to) => withDemoSearch(to, enabled),
      exitHref: `/${DEMO_EXIT_QUERY}`,
      bootstrap: (pathname, search) => {
        const nextEnabled = initDemoMode("/", search);
        if (nextEnabled) {
          ensureDemoFetchInterceptor();
        }
        setEnabled(nextEnabled);
        void pathname;
      },
      clear: () => {
        clearDemoMode();
        setEnabled(false);
      },
    };
  }, [enabled]);

  return (
    <DemoModeContext.Provider value={value}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode(): DemoModeContextValue {
  return useContext(DemoModeContext);
}
