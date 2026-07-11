import { describe, expect, test } from "bun:test";

import {
  cableLoopResistanceMohmToTpsCdcRise,
  calculateCableLoopCompensation,
  tpsCdcRiseToCableLoopResistanceMohm,
} from "./DevicePowerPanelControls";

describe("cable loop compensation", () => {
  test("maps the TPS CDC register ladder to loop resistance", () => {
    expect(tpsCdcRiseToCableLoopResistanceMohm(500)).toBe(100);
    expect(cableLoopResistanceMohmToTpsCdcRise(100)).toBe(500);
  });

  test("calculates TPS compensation from voltage drop and load current", () => {
    expect(calculateCableLoopCompensation(300, 3000, 20, 140)).toEqual({
      measuredMohm: 100,
      recommendedMohm: 100,
      clamped: false,
    });
  });

  test("rounds down to the supported compensation ladder", () => {
    expect(calculateCableLoopCompensation(299, 3000, 20, 140)).toEqual({
      measuredMohm: 99.66666666666667,
      recommendedMohm: 80,
      clamped: false,
    });
  });

  test("clamps each controller calculator at its supported maximum", () => {
    expect(calculateCableLoopCompensation(800, 4000, 20, 140)).toEqual({
      measuredMohm: 200,
      recommendedMohm: 140,
      clamped: true,
    });
    expect(calculateCableLoopCompensation(800, 4000, 50, 150)).toEqual({
      measuredMohm: 200,
      recommendedMohm: 150,
      clamped: true,
    });
  });

  test("rejects invalid measurement inputs", () => {
    expect(calculateCableLoopCompensation(-1, 1000, 20, 140)).toBeNull();
    expect(calculateCableLoopCompensation(100, 0, 20, 140)).toBeNull();
    expect(calculateCableLoopCompensation(100, -1, 20, 140)).toBeNull();
  });
});
