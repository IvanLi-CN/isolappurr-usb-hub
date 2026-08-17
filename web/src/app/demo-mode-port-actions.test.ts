import { expect, test } from "bun:test";
import { handleDemoPortAction } from "./demo-mode-port-actions";
import {
  createCanonicalDemoWorld,
  type DemoWorld,
  findByDeviceId,
} from "./demo-mode-world";

function createActionWorld() {
  let world = createCanonicalDemoWorld();
  const deviceId = "aabbcc001122";
  const record = findByDeviceId(world, deviceId);
  if (!record) {
    throw new Error("Expected canonical demo device");
  }
  return {
    deviceId,
    record,
    readWorld: () => world,
    updateWorld: (mutator: (current: DemoWorld) => DemoWorld) => {
      world = mutator(world);
      return world;
    },
  };
}

test("demo data action changes the runtime link and preserves Local USB envelopes", async () => {
  const fixture = createActionWorld();
  const response = handleDemoPortAction({
    deviceId: fixture.deviceId,
    localUsb: true,
    method: "POST",
    path: "ports/port_a/data",
    record: fixture.record,
    updateWorld: fixture.updateWorld,
    url: new URL("http://demo.local/ports/port_a/data?connected=0"),
  });

  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({
    response: { accepted: true, data_connected: false },
  });
  expect(
    findByDeviceId(fixture.readWorld(), fixture.deviceId)?.ports.ports[0]?.state
      .data_connected,
  ).toBeFalse();
});

test("demo data action rejects a connect while port power is off", async () => {
  const fixture = createActionWorld();
  const port = fixture.record.ports.ports[0];
  port.state.power_enabled = false;
  port.state.data_connected = false;
  const response = handleDemoPortAction({
    deviceId: fixture.deviceId,
    localUsb: false,
    method: "POST",
    path: "/api/v1/ports/port_a/data",
    record: fixture.record,
    updateWorld: fixture.updateWorld,
    url: new URL("http://demo.local/api/v1/ports/port_a/data?connected=1"),
  });

  expect(response?.status).toBe(409);
  expect(await response?.json()).toMatchObject({
    error: { code: "port_power_off", retryable: false },
  });
});
