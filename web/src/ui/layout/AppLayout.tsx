import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useDemoMode } from "../../app/demo-mode";
import { DemoLink } from "../../app/demo-navigation";
import { useTheme } from "../../app/theme-ui";
import { IconButton } from "../actions/ActionButton";
import { BrandMark } from "../brand/BrandMark";
import { ThemeMenu } from "../nav/ThemeMenu";
import { DemoControlPanel } from "./DemoControlPanel";

export type AppLayoutHeaderInfo = {
  title: string;
  subtitle: string;
  mobileTitle?: string;
};

type SidebarRenderContext = {
  closeMobileSidebar: () => void;
  forMobileDrawer: boolean;
};

export function AppLayout({
  sidebar,
  children,
  headerInfo,
  showMobileSidebarDrawer = false,
}: {
  sidebar: ReactNode | ((context: SidebarRenderContext) => ReactNode);
  children: ReactNode;
  headerInfo?: AppLayoutHeaderInfo | null;
  showMobileSidebarDrawer?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const { enabled: demoEnabled } = useDemoMode();
  const location = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastRouteKeyRef = useRef(`${location.pathname}${location.search}`);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const routeKey = `${location.pathname}${location.search}`;

  const showTheme = location.pathname === "/" || location.pathname === "/about";
  const showDemoControl = demoEnabled && location.pathname !== "/flash";
  const mobileBrandLabel = headerInfo?.mobileTitle ?? headerInfo?.title;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (mobileDrawerOpen && !dialog.open) {
      dialog.showModal();
      return;
    }
    if (!mobileDrawerOpen && dialog.open) {
      dialog.close();
    }
  }, [mobileDrawerOpen]);

  useEffect(() => {
    if (lastRouteKeyRef.current === routeKey) {
      return;
    }
    lastRouteKeyRef.current = routeKey;
    setMobileDrawerOpen(false);
  }, [routeKey]);

  const closeMobileDrawer = () => {
    setMobileDrawerOpen(false);
    window.setTimeout(() => {
      triggerRef.current?.focus();
    }, 0);
  };

  const aboutClassName =
    "flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent px-3 text-[12px] font-bold text-[var(--text)] sm:px-4";
  const mobileTriggerClassName =
    "h-9 w-9 shrink-0 rounded-[10px] border border-[var(--border)] text-[16px] leading-none";
  const renderSidebar = (forMobileDrawer: boolean) =>
    typeof sidebar === "function"
      ? sidebar({
          closeMobileSidebar: closeMobileDrawer,
          forMobileDrawer,
        })
      : sidebar;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--panel-2)]">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-16 items-center justify-between gap-3 lg:hidden">
            <DemoLink
              className="flex min-w-0 items-center gap-2.5 truncate text-[16px] font-bold"
              to="/"
            >
              <BrandMark
                className="h-8 w-8 shrink-0"
                variant={theme === "isolapurr-dark" ? "dark" : "color"}
              />
              <span
                className="min-w-0 truncate"
                data-testid="app-header-mobile-title"
              >
                {mobileBrandLabel ?? "IsolaPurr USB Hub"}
              </span>
            </DemoLink>
            <div className="flex shrink-0 items-center gap-2">
              {showDemoControl ? <DemoControlPanel /> : null}
              {showTheme ? (
                <div className="hidden sm:block">
                  <ThemeMenu value={theme} onChange={setTheme} />
                </div>
              ) : null}
              {showMobileSidebarDrawer ? (
                <IconButton
                  ref={triggerRef}
                  aria-expanded={mobileDrawerOpen}
                  aria-haspopup="dialog"
                  className={mobileTriggerClassName}
                  label="Open devices"
                  onClick={() => setMobileDrawerOpen(true)}
                  data-testid="mobile-device-drawer-trigger"
                >
                  ☰
                </IconButton>
              ) : (
                <DemoLink className={aboutClassName} to="/about">
                  About
                </DemoLink>
              )}
            </div>
          </div>

          <div
            className={[
              "hidden lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-8",
              headerInfo ? "lg:min-h-[88px]" : "lg:h-16",
            ].join(" ")}
          >
            <div className="flex min-w-0 items-center">
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
            </div>

            <div
              className={[
                "flex min-w-0 items-center gap-6 py-3",
                headerInfo ? "justify-between" : "justify-end",
              ].join(" ")}
            >
              {headerInfo ? (
                <div className="min-w-0">
                  <div
                    className="truncate text-[24px] font-bold leading-8"
                    data-testid="app-header-device-title"
                  >
                    {headerInfo.title}
                  </div>
                  <div
                    className="mt-1 truncate font-mono text-[12px] font-semibold text-[var(--muted)]"
                    data-testid="app-header-device-subtitle"
                  >
                    {headerInfo.subtitle}
                  </div>
                </div>
              ) : null}

              <div className="flex shrink-0 items-center gap-3">
                {showDemoControl ? <DemoControlPanel /> : null}
                {showTheme ? (
                  <div className="hidden sm:block">
                    <ThemeMenu value={theme} onChange={setTheme} />
                  </div>
                ) : null}
                <DemoLink className={aboutClassName} to="/about">
                  About
                </DemoLink>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-x-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col lg:flex-row lg:overflow-hidden">
          <aside
            className={[
              "w-full min-h-0 shrink-0 border-b border-[var(--border)] bg-[var(--sidebar-bg)] lg:w-[360px] lg:overflow-y-auto lg:border-b-0 lg:border-r",
              showMobileSidebarDrawer ? "hidden lg:block" : "",
            ].join(" ")}
          >
            {renderSidebar(false)}
          </aside>
          <main className="min-h-0 min-w-0 flex-1 px-4 py-6 sm:px-6 lg:overflow-y-auto lg:px-8">
            {children}
          </main>
        </div>
      </div>

      {showMobileSidebarDrawer ? (
        <dialog
          ref={dialogRef}
          className="modal items-stretch justify-end p-0"
          aria-label="Devices"
          data-testid="mobile-device-drawer"
          onCancel={(event) => {
            event.preventDefault();
            closeMobileDrawer();
          }}
          onClose={() => {
            if (mobileDrawerOpen) {
              setMobileDrawerOpen(false);
            }
          }}
          onClick={(event) => {
            if (event.target === dialogRef.current) {
              closeMobileDrawer();
            }
          }}
          onKeyDown={(event) => {
            if (event.target !== dialogRef.current) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              closeMobileDrawer();
            }
          }}
        >
          <div className="iso-drawer-box flex h-dvh w-full max-w-[380px] flex-col border-l border-[var(--border)] bg-[var(--panel)] shadow-[0_24px_64px_var(--shadow)]">
            {renderSidebar(true)}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
