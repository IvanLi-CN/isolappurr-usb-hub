import { useEffect } from "react";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router";
import { AddDeviceUiProvider } from "./app/add-device-ui";
import { DemoModeProvider, useDemoMode } from "./app/demo-mode";
import { DemoLink, useDemoNavigate } from "./app/demo-navigation";
import { DesktopAgentProvider } from "./app/desktop-agent-ui";
import { DeviceRuntimeProvider } from "./app/device-runtime";
import { DevicesProvider, useDevices } from "./app/devices-store";
import { ThemeProvider } from "./app/theme-ui";
import type { AddDeviceInput } from "./domain/devices";
import { AboutPage } from "./pages/AboutPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DeviceDashboardPage } from "./pages/DeviceDashboardPage";
import { DeviceInfoPage } from "./pages/DeviceInfoPage";
import { DevicePowerPage } from "./pages/DevicePowerPage";
import { FirmwareFlashPage } from "./pages/FirmwareFlashPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PwaInstallProvider } from "./pwa/install";
import { AppLayout } from "./ui/layout/AppLayout";
import { DeviceListPanel } from "./ui/panels/DeviceListPanel";
import { ToastProvider } from "./ui/toast/ToastProvider";

function RootLayout() {
  const { deviceId } = useParams();
  const location = useLocation();
  const { enabled: demoEnabled } = useDemoMode();
  const { devices, addDevice, getDevice, upsertDevice } = useDevices();
  const navigate = useDemoNavigate();
  const forceEmptySidebar = demoEnabled && location.pathname === "/flash";
  const isDashboardRoute = location.pathname === "/";
  const isDeviceDetailRoute = Boolean(
    deviceId &&
      [
        `/devices/${deviceId}`,
        `/devices/${deviceId}/info`,
        `/devices/${deviceId}/power`,
      ].includes(location.pathname),
  );
  const showMobileSidebarDrawer =
    !forceEmptySidebar && (isDashboardRoute || isDeviceDetailRoute);
  const selectedDevice = deviceId ? getDevice(deviceId) : undefined;
  const shortId =
    selectedDevice && selectedDevice.id.length > 6
      ? selectedDevice.id.slice(0, 6)
      : selectedDevice?.id;
  const headerInfo =
    isDeviceDetailRoute && selectedDevice
      ? {
          mobileTitle: selectedDevice.name,
          subtitle: `id: ${shortId} • ${selectedDevice.baseUrl}`,
          title: selectedDevice.name,
        }
      : null;

  const existingIds = devices.map((d) => d.id);
  const existingBaseUrls = devices.map((d) => d.baseUrl);
  const existingNamesById = Object.fromEntries(
    devices.map((d) => [d.id, d.name]),
  );

  const onAdd = async (input: AddDeviceInput) => {
    const result = await addDevice(input);
    if (!result.ok) {
      return result;
    }
    navigate(`/devices/${result.device.id}`);
    return result;
  };

  return (
    <AddDeviceUiProvider
      existingDeviceIds={existingIds}
      existingDeviceBaseUrls={existingBaseUrls}
      existingDeviceNamesById={existingNamesById}
      onCreate={onAdd}
      onUpsert={upsertDevice}
    >
      <AppLayout
        headerInfo={headerInfo}
        showMobileSidebarDrawer={showMobileSidebarDrawer}
        sidebar={({ closeMobileSidebar, forMobileDrawer }) => (
          <DeviceListPanel
            devices={devices}
            footer={
              forMobileDrawer ? (
                <DemoLink
                  className="flex h-10 items-center justify-center rounded-[12px] border border-[var(--border)] bg-transparent px-4 text-[13px] font-bold text-[var(--text)]"
                  to="/about"
                  onClick={closeMobileSidebar}
                  data-testid="mobile-device-drawer-about"
                >
                  About
                </DemoLink>
              ) : undefined
            }
            forceEmptyState={forceEmptySidebar}
            headerAccessory={
              forMobileDrawer ? (
                <button
                  aria-label="Close devices"
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-transparent text-[18px] font-semibold text-[var(--muted)] transition-colors hover:text-[var(--text)]"
                  type="button"
                  onClick={closeMobileSidebar}
                >
                  ×
                </button>
              ) : undefined
            }
            onBeforeAddDevice={forMobileDrawer ? closeMobileSidebar : undefined}
            onSelect={(id) => {
              if (forMobileDrawer) {
                closeMobileSidebar();
              }
              navigate(`/devices/${id}`);
            }}
            selectedDeviceId={deviceId}
          />
        )}
      >
        <Outlet />
      </AppLayout>
    </AddDeviceUiProvider>
  );
}

function DemoBootstrapper() {
  const location = useLocation();
  const { bootstrap } = useDemoMode();

  useEffect(() => {
    bootstrap(location.pathname, location.search);
  }, [bootstrap, location.pathname, location.search]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <DemoModeProvider>
        <DemoBootstrapper />
        <DesktopAgentProvider>
          <PwaInstallProvider>
            <ThemeProvider>
              <ToastProvider>
                <DevicesProvider>
                  <DeviceRuntimeProvider>
                    <Routes>
                      <Route path="/" element={<RootLayout />}>
                        <Route index element={<DashboardPage />} />
                        <Route
                          path="devices/:deviceId"
                          element={<DeviceDashboardPage />}
                        />
                        <Route
                          path="devices/:deviceId/info"
                          element={<DeviceInfoPage />}
                        />
                        <Route
                          path="devices/:deviceId/power"
                          element={<DevicePowerPage />}
                        />
                        <Route path="flash" element={<FirmwareFlashPage />} />
                        <Route path="about" element={<AboutPage />} />
                      </Route>
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </DeviceRuntimeProvider>
                </DevicesProvider>
              </ToastProvider>
            </ThemeProvider>
          </PwaInstallProvider>
        </DesktopAgentProvider>
      </DemoModeProvider>
    </BrowserRouter>
  );
}
