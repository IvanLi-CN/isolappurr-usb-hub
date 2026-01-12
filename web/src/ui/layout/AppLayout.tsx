import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "../../app/theme-ui";
import { ThemeMenu } from "../nav/ThemeMenu";

export function AppLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const location = useLocation();

  const showTheme = location.pathname === "/" || location.pathname === "/about";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="h-16 border-b border-[var(--border)] bg-[var(--panel-2)]">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between px-8">
          <Link className="text-[16px] font-bold" to="/">
            Isolapurr USB Hub
          </Link>
          <div className="flex items-center gap-3">
            {showTheme ? <ThemeMenu value={theme} onChange={setTheme} /> : null}
            <Link
              className="flex h-9 w-[92px] items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[12px] font-bold text-[var(--text)]"
              to="/about"
            >
              About
            </Link>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-x-hidden">
        <div className="mx-auto flex w-full min-h-0 max-w-[1600px] flex-col xl:flex-row">
          <aside className="w-full shrink-0 border-b border-[var(--border)] bg-[var(--sidebar-bg)] xl:w-[360px] xl:border-b-0 xl:border-r">
            {sidebar}
          </aside>
          <main className="min-h-0 min-w-0 flex-1 px-8 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
