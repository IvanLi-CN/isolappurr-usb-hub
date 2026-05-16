---
title: USB-C sink output verification
module: hardware
problem_type: hardware-debug
component: sw2303-tps55288
tags:
  - usb-c
  - pd
  - pps
  - sw2303
  - tps55288
  - loadlynx
status: active
related_specs: []
applicability: Sink-side voltage verification applies to all tps-sw hardware; shared SDA_TPS/SCL_TPS recovery notes apply only to hardware where SW2303 and TPS55288 share one I2C bus.
symptoms:
  - TPS output telemetry reports the requested voltage, but the USB-C sink may still see no or wrong output.
  - A PD sink reports a contract that can differ from the voltage measured at the sink terminals.
  - SW2303 can be briefly readable before TPS VOUT is established, then hold SDA_TPS low after TPS output is enabled.
root_cause: U17/INA226 measures VOUT_TPS before the SW2303-controlled pass path; SDA_TPS stuck-low also prevents firmware from reading SW2303 target registers after TPS output is enabled.
resolution_type: measurement-procedure
---

# USB-C Sink Output Verification

## Context

The `tps-sw` power path is `TPS55288 VOUT_TPS -> Q7 -> VBUS_TPS -> USB-C connector`.
`SW2303` controls the pass path and negotiates USB-PD. `INA226 U17` is on
`VOUT_TPS`, so it can confirm the TPS front-end voltage/current but cannot prove
that the USB-C sink actually receives `VBUS_TPS`.

In the `tps-sw` netlist, `SW2303` uses `SDA_SW/SCL_SW` and `TPS55288` uses
`SDA/SCL`. The sink-side measurement procedure still applies, but SW2303 bus
faults should be handled as SW read faults rather than as TPS boot-bus faults.

## Symptoms

- Firmware logs show TPS output telemetry near the requested voltage, but the
  sink still appears unpowered or stuck near 5 V.
- LoadLynx can report a requested PD/PPS contract while its measured terminal
  voltage remains different.
- `SDA_TPS=false, SCL_TPS=true` after TPS output is enabled means the shared PD
  I2C bus is not usable, so firmware cannot read SW2303 target voltage/current
  registers at that moment.
- After the firmware fix and hardware repair, a 7 V PPS request with a 250 mA
  LoadLynx CC load held around 7.01-7.06 V at the sink terminals for more than
  2 minutes.
- If the firmware clamps TPS55288 below-5 V setpoints to 5 V, LoadLynx can show
  a 3.3-4.5 V PPS contract while the connector stays near 5 V.
- LoadLynx `POST /api/v1/cc` updates the CC API view, but does not necessarily
  change the active electronic-load preset. For proof current, update/apply the
  active preset and enable `/api/v1/control`.
- Repeated `CE_TPS` probing can disturb the PD/source state and should not be
  treated as a stable output test.

## Root Cause

The main measurement trap is confusing front-end TPS output with connector-side
USB-C output:

- `VOUT_TPS`: TPS output and INA226 U17 measurement point.
- `VBUS_TPS`: USB-C connector VBUS after Q7.
- `SW2303` may keep or reopen Q7 based on its own state and protection logic.

Therefore a firmware log such as TPS output telemetry at 7 V is not sufficient
evidence that the USB-C port is outputting 7 V.

A separate control-loop trap is assuming SW2303 can always be polled after TPS
VOUT is enabled. On shared-bus hardware, `SW2303` and `TPS55288` share
`SDA_TPS/SCL_TPS`, while SW2303 VIN is powered by TPS VOUT. If SW2303 holds SDA
low after VOUT is established, both SW2303 and TPS55288 become inaccessible on
that bus. On the `tps-sw` netlist, SW2303 is isolated onto `SDA_SW/SCL_SW`, so
firmware should keep the last known TPS setpoint stable while reporting SW bus
read faults, without treating that condition as a TPS I2C boot failure.

## Resolution

Use a real sink-side instrument as the acceptance signal. With LoadLynx, verify
the actual USB-C output using the device API/page readback:

1. Set the PD sink request within the safe debug range.

```js
await fetch("http://192.168.31.216/api/v1/pd", {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: JSON.stringify({
    mode: "pps",
    object_pos: 6,
    target_mv: 7000,
    i_req_ma: 500,
  }),
});
```

2. Set a bounded CC load and enable output.

```js
await fetch("http://192.168.31.216/api/v1/presets", {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: JSON.stringify({
    preset_id: 3,
    mode: "cc",
    target_i_ma: 450,
    target_v_mv: 7000,
    target_p_mw: 0,
    min_v_mv: 0,
    max_i_ma_total: 500,
    max_p_mw: 3500,
  }),
});

await fetch("http://192.168.31.216/api/v1/control", {
  method: "POST",
  headers: { "Content-Type": "text/plain" },
  body: JSON.stringify({ output_enabled: true }),
});
```

3. Treat `/api/v1/cc` or the LoadLynx page readout as the sink-side proof.

```js
const cc = await fetch("http://192.168.31.216/api/v1/cc").then((r) => r.json());
console.log({
  v_main_mv: cc.v_main_mv,
  i_total_ma: cc.i_total_ma,
  p_main_mw: cc.p_main_mw,
});
```

The pass condition for this debug setup is terminal voltage in the requested
USB-PD/PPS range and load current within the configured limit. A 7 V PD/PPS
request with a LoadLynx `v_main_mv` still near 5 V means the USB-C port did not
follow the requested sink voltage, even if the PD contract endpoint reports 7 V.

Observed passing pattern:

- LoadLynx `/api/v1/pd` reports `attached=true`, `contract_mv=7000`,
  `contract_ma=500`, and `apply.pending=false`.
- LoadLynx `/api/v1/status` reports `enable=true`, terminal voltage around
  `7011-7059 mV`, and current around `247-251 mA` with the 250 mA CC preset.
- Firmware logs show `sw2303 stable reads` continuing, `v_req_mv=7000`, and
  SW2303 ADC readback around `vin_mv=7050`, `vbus_mv=7035-7042`.
- With the TPS55288 low-voltage clamp removed, reconnect-style PPS negotiation
  also works below 5 V: tested targets `3300`, `3600`, `3900`, `4200`, and
  `4500 mV` produced LoadLynx `v_main_mv` around `3331`, `3638`, `3981`,
  `4229`, and `4536 mV` at a 100 mA load setting.
- At a real 500 mA LoadLynx preset, reconnect-style PPS negotiation worked at
  `3300`, `3900`, and `4500 mV`; LoadLynx reported local current around
  `499 mA` and no fault flags.
- In-place PPS target changes made through the LoadLynx HTTP API are not enough
  by themselves as acceptance proof. If `contract_mv` changes but SW2303 target
  registers and `v_main_mv` do not move, treat the test as a sink/request
  stimulus problem and rerun with a reconnect-style negotiation.

Observed diagnostic pattern:

- Before the first TPS boot-setpoint write, SW2303 may return the default
  request (`5000 mV`, high current limit) and can sometimes accept the enable
  profile.
- After TPS VOUT is enabled, the bus can settle at `SDA_TPS=low`,
  `SCL_TPS=high`; bus recovery clocks do not release SDA.
- Forcing TPS to 7 V before SDA becomes stuck raises front-end TPS telemetry to
  about 7 V, but LoadLynx can still report the USB-C terminal near 5 V. TPS
  front-end voltage alone is not sufficient; SW2303/Q7 pass-path state still
  determines connector output.

## Guardrails / Reuse Notes

- Do not use `INA226 U17` as proof of USB-C connector voltage. It is a TPS
  front-end observation point only.
- Do not use `INA226` readings for TPS/SW2303 gating decisions.
- Do not read, model, log, display, or use the SW2303 connection-indicator field.
- Do not force `SW2303` pass-path control to make a test pass; that can bypass
  SW2303 protection/voltage matching logic.
- Keep LoadLynx debug requests in the agreed safe range unless the owner
  explicitly changes it: PD sink voltage 3.3-7 V and load current 0-500 mA.
- When the bus is stuck, avoid repeated `CE_TPS` probing during output
  verification. It can reset the TPS/SW2303 path and invalidate the sink-side
  measurement.

## References

- `hardware/tps-sw/netlist.enet`
- `docs/netlist/tps-sw-checklist.md`
- `src/bin/main.rs`
