import {
  cloneWorld,
  type DemoDeviceRecord,
  type DemoWorld,
  findByDeviceId,
} from "./demo-mode-world";

type UpdateWorld = (mutator: (world: DemoWorld) => DemoWorld) => DemoWorld;

type DemoPortActionRequest = {
  deviceId: string;
  localUsb: boolean;
  method: string;
  path: string;
  record: DemoDeviceRecord;
  updateWorld: UpdateWorld;
  url: URL;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function mutatePort(
  updateWorld: UpdateWorld,
  deviceId: string,
  portId: "port_a" | "port_c",
  mutate: (port: DemoDeviceRecord["ports"]["ports"][number]) => void,
) {
  updateWorld((current) => {
    const next = cloneWorld(current);
    const port = findByDeviceId(next, deviceId)?.ports.ports.find(
      (item) => item.portId === portId,
    );
    if (port) {
      mutate(port);
    }
    return next;
  });
}

export function handleDemoPortAction({
  deviceId,
  localUsb,
  method,
  path,
  record,
  updateWorld,
  url,
}: DemoPortActionRequest): Response | null {
  if (method !== "POST" || !path.includes("ports/")) {
    return null;
  }
  const portId = path.includes("port_a") ? "port_a" : "port_c";
  const wrap = (body: Record<string, unknown>, status = 200) =>
    response(localUsb ? { response: body } : body, status);

  if (path.endsWith("/power")) {
    const enabled = url.searchParams.get("enabled") === "1";
    mutatePort(updateWorld, deviceId, portId, (port) => {
      port.state.power_enabled = enabled;
      port.state.data_connected = enabled;
    });
    return wrap({ accepted: true, power_enabled: enabled });
  }
  if (!path.endsWith("/data")) {
    return null;
  }

  const connected = url.searchParams.get("connected") === "1";
  const port = record.ports.ports.find((item) => item.portId === portId);
  if (connected && !port?.state.power_enabled) {
    return response(
      {
        error: {
          code: "port_power_off",
          message: "Enable port power before connecting the data link",
          retryable: false,
        },
      },
      409,
    );
  }
  mutatePort(updateWorld, deviceId, portId, (target) => {
    target.state.data_connected = connected;
  });
  return wrap({ accepted: true, data_connected: connected });
}
