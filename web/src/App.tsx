import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router";
import { DevicesProvider, useDevices } from "./app/devices-store";
import type { AddDeviceInput } from "./domain/devices";
import { DeviceDashboardPage } from "./pages/DeviceDashboardPage";
import { DeviceInfoPage } from "./pages/DeviceInfoPage";
import { DevicesIndexPage } from "./pages/DevicesIndexPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { AppLayout } from "./ui/layout/AppLayout";
import { DeviceListPanel } from "./ui/panels/DeviceListPanel";
import { ToastProvider } from "./ui/toast/ToastProvider";

function RootLayout() {
  const { deviceId } = useParams();
  const { devices, addDevice, removeDevice } = useDevices();
  const navigate = useNavigate();

  const onAdd = (input: AddDeviceInput) => {
    const result = addDevice(input);
    if (!result.ok) {
      return;
    }
    navigate(`/devices/${result.device.id}`);
  };

  return (
    <AppLayout
      sidebar={
        <DeviceListPanel
          devices={devices}
          selectedDeviceId={deviceId}
          onSelect={(id) => navigate(`/devices/${id}`)}
          onRemove={(id) => {
            removeDevice(id);
            if (deviceId === id) {
              navigate("/");
            }
          }}
          onAdd={onAdd}
        />
      }
    >
      <Outlet />
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <DevicesProvider>
          <Routes>
            <Route path="/" element={<RootLayout />}>
              <Route index element={<DevicesIndexPage />} />
              <Route
                path="devices/:deviceId"
                element={<DeviceDashboardPage />}
              />
              <Route
                path="devices/:deviceId/info"
                element={<DeviceInfoPage />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </DevicesProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
