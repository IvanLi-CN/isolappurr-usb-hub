import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { useDemoMode } from "../../app/demo-mode";
import { DemoLink, useDemoNavigate } from "../../app/demo-navigation";
import { useTheme } from "../../app/theme-ui";
import { BrandMark } from "../brand/BrandMark";
import { ThemeMenu } from "../nav/ThemeMenu";

export function AppLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const navigate = useDemoNavigate();
  const { enabled: demoEnabled, clear, exitHref } = useDemoMode();
  const location = useLocation();

  const showTheme = location.pathname === "/" || location.pathname === "/about";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="h-16 border-b border-[var(--border)] bg-[var(--panel-2)]">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <DemoLink
            className="flex min-w-0 items-center gap-2.5 truncate text-[16px] font-bold"
            to="/"
          >
            <BrandMark
              className="h-8 w-8 shrink-0"
              variant={theme === "isolapurr-dark" ? "dark" : "color"}
            />
            <span className="min-w-0 truncate">IsolaPurr USB Hub</span>
          </DemoLink>
          <div className="flex items-center gap-3">
            {demoEnabled ? (
              <>
                <div className="inline-flex h-9 items-center rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] font-bold text-[var(--warning)]">
                  Demo mode
                </div>
                <button
                  className="flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-3 text-[12px] font-bold text-[var(--text)] sm:px-4"
                  type="button"
                  onClick={() => {
                    clear();
                    navigate(exitHref, { replace: true });
                  }}
                >
                  Exit demo
                </button>
              </>
            ) : null}
            {showTheme ? (
              <div className="hidden sm:block">
                <ThemeMenu value={theme} onChange={setTheme} />
              </div>
            ) : null}
            <DemoLink
              className="flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-3 text-[12px] font-bold text-[var(--text)] sm:px-4"
              to="/about"
            >
              About
            </DemoLink>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-x-hidden">
        <div className="mx-auto flex w-full min-h-0 max-w-[1600px] flex-col xl:flex-row xl:overflow-hidden">
          <aside className="w-full min-h-0 shrink-0 border-b border-[var(--border)] bg-[var(--sidebar-bg)] xl:w-[360px] xl:overflow-y-auto xl:border-b-0 xl:border-r">
            {sidebar}
          </aside>
          <main className="min-h-0 min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 xl:overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
