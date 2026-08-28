import type { DemoWorld } from "./demo-mode-world";

export function applyDemoIpScan(
  world: DemoWorld,
  cidr: string,
  runId: number,
): DemoWorld {
  return {
    ...world,
    discovery: {
      ...world.discovery,
      mode: "service",
      status: "ready",
      scan: {
        cidr,
        done: world.discovery.devices.length,
        total: world.discovery.devices.length,
        status: "ready",
        devices: world.discovery.devices,
        runId,
        reachableResponses: Math.max(world.discovery.devices.length, 1),
      },
    },
  };
}

export function cancelDemoIpScan(
  world: DemoWorld,
  runId: number | undefined,
): DemoWorld {
  if (runId !== undefined && world.discovery.scan?.runId !== runId) {
    return world;
  }
  return {
    ...world,
    discovery: { ...world.discovery, scan: undefined },
  };
}
