import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router";
import { AddDeviceUiProvider } from "./app/add-device-ui";
import { DeviceRuntimeProvider } from "./app/device-runtime";
import { DevicesProvider, useDevices } from "./app/devices-store";
import { ThemeProvider } from "./app/theme-ui";
import type { AddDeviceInput } from "./domain/devices";
import { AboutPage } from "./pages/AboutPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DeviceDashboardPage } from "./pages/DeviceDashboardPage";
import { DeviceInfoPage } from "./pages/DeviceInfoPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { AppLayout } from "./ui/layout/AppLayout";
import { DeviceListPanel } from "./ui/panels/DeviceListPanel";
import { ToastProvider } from "./ui/toast/ToastProvider";

function RootLayout() {
  const { deviceId } = useParams();
  const { devices, addDevice } = useDevices();
  const navigate = useNavigate();

  const existingIds = devices.map((d) => d.id);
  const existingBaseUrls = devices.map((d) => d.baseUrl);

  const onAdd = (input: AddDeviceInput) => {
    const result = addDevice(input);
    if (!result.ok) {
      return;
    }
    navigate(`/devices/${result.device.id}`);
  };

  return (
    <AddDeviceUiProvider
      existingDeviceIds={existingIds}
      existingDeviceBaseUrls={existingBaseUrls}
      onCreate={onAdd}
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

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
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
                  <Route path="about" element={<AboutPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </DeviceRuntimeProvider>
          </DevicesProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
