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
import { useDemoNavigate } from "./app/demo-navigation";
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
import { NotFoundPage } from "./pages/NotFoundPage";
import { AppLayout } from "./ui/layout/AppLayout";
import { DeviceListPanel } from "./ui/panels/DeviceListPanel";
import { ToastProvider } from "./ui/toast/ToastProvider";

function RootLayout() {
  const { deviceId } = useParams();
  const { devices, addDevice, upsertDevice } = useDevices();
  const navigate = useDemoNavigate();

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
        sidebar={
          <DeviceListPanel
            devices={devices}
            selectedDeviceId={deviceId}
            onSelect={(id) => navigate(`/devices/${id}`)}
          />
        }
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
                      <Route path="about" element={<AboutPage />} />
                    </Route>
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </DeviceRuntimeProvider>
              </DevicesProvider>
            </ToastProvider>
          </ThemeProvider>
        </DesktopAgentProvider>
      </DemoModeProvider>
    </BrowserRouter>
  );
}
