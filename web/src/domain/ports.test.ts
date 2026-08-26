import { describe, expect, test } from "bun:test";

import { resolvePortControlAvailability } from "./ports";

describe("resolvePortControlAvailability", () => {
  test("enables an explicitly supported schema v1 control", () => {
    expect(
      resolvePortControlAvailability(1, { data_set: true }, "data_set"),
    ).toEqual({ state: "supported" });
  });

  test("reports an explicitly unsupported schema v1 control", () => {
    expect(
      resolvePortControlAvailability(1, { data_set: false }, "data_set"),
    ).toEqual({
      state: "unsupported",
      reason: "This device does not support the Data link control.",
    });
  });

  test.each([
    [undefined, { data_set: true }],
    [2, { data_set: true }],
    [1, {}],
    [1, undefined],
  ] as const)("keeps incomplete declarations unknown: %p %p", (schema, capabilities) => {
    expect(
      resolvePortControlAvailability(schema, capabilities, "data_set"),
    ).toEqual({
      state: "unknown",
      reason:
        "This device has not declared the Data link control capability, so it is unavailable.",
    });
  });
});
