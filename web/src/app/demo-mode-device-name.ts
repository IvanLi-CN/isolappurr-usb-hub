import {
  normalizeDeviceDisplayName,
  validateDeviceDisplayName,
} from "../domain/deviceName";
import { cloneWorld, type DemoWorld, findByDeviceId } from "./demo-mode-world";

export function handleDemoDeviceNameRequest(
  method: string,
  init: RequestInit | undefined,
  deviceId: string,
  readJsonBody: (init?: RequestInit) => unknown,
  updateWorld: (mutator: (world: DemoWorld) => DemoWorld) => DemoWorld,
  jsonResponse: (body: unknown) => Response,
  apiError: (status: number, code: string, message: string) => Response,
): Response | null {
  if (method === "PUT") {
    const body = readJsonBody(init) as { name?: unknown } | null;
    const value = typeof body?.name === "string" ? body.name : "";
    const name = normalizeDeviceDisplayName(value);
    const error = validateDeviceDisplayName(name);
    if (error) return apiError(400, "invalid_name", error);
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.info.device.display_name = name;
        target.stored.deviceNameCache = { state: "value", value: name };
      }
      return mutated;
    });
    return jsonResponse({ display_name: name });
  }
  if (method === "DELETE") {
    updateWorld((current) => {
      const mutated = cloneWorld(current);
      const target = findByDeviceId(mutated, deviceId);
      if (target) {
        target.info.device.display_name = null;
        target.stored.deviceNameCache = { state: "unset" };
      }
      return mutated;
    });
    return jsonResponse({ display_name: null });
  }
  return null;
}
