---
title: SW2303 and TPS55288 shared I2C startup
module: hardware
problem_type: hardware-debug
component: sw2303-tps55288
tags:
  - sw2303
  - tps55288
  - i2c
  - startup
status: active
related_specs: []
symptoms:
  - TPS55288 can be configured only when SDA_TPS/SCL_TPS are released.
  - After TPS active discharge, SDA_TPS/SCL_TPS can both read low.
  - After TPS 5V boot output is enabled, SDA_TPS can be held low while SCL_TPS stays high.
  - SW2303 cannot be read when SDA_TPS is held low.
  - SW2303 target reads can ACK only after its POR window while the bus stays released.
root_cause: SW2303 VIN is powered by TPS55288 VOUT while SW2303 and TPS55288 share SDA_TPS/SCL_TPS, so firmware must keep SDA_TPS/SCL_TPS released through SW2303 POR before using the shared bus.
resolution_type: firmware-guardrail
---

# SW2303 and TPS55288 Shared I2C Startup

## Context

The `tps-sw` topology powers `SW2303` from `TPS55288 VOUT_TPS`. Both chips share
`SDA_TPS/SCL_TPS` with 4.7 kΩ pull-ups to `3V3`. Firmware must program
`TPS55288` to 5 V before it can safely talk to `SW2303`, but `SW2303` is not a
valid I2C target until its POR window has completed with the bus released.

## Symptoms

- On a clean boot, `SDA_TPS/SCL_TPS` are high during the pre-I2C open-drain
  release window.
- `TPS55288` accepts the 5 V boot setpoint at 400 kHz.
- After TPS `OE` is cleared and active discharge is enabled for about 1 second,
  `SDA_TPS/SCL_TPS` can both read low; treat this as a shared-bus stuck-low
  condition before trying to configure the 5 V boot setpoint.
- A single `CE_TPS` hard-start can restore the bus; on the tested board the
  lines returned high about 50 ms after CE release, while the first post-POR TPS
  I2C transaction still required a controlled retry.
- If the MCU starts I2C traffic while SW2303 is still in its POR window, the
  shared bus can fail with `SW2303(0x3C)` read timeouts.
- With `SDA_TPS/SCL_TPS` released through the SW2303 POR window, logs show
  `sda_high=true scl_high=true` before the first SW2303 target read.
- A too-short POR wait made even a single SW2303 register probe require about
  14-15 retries; a longer released-bus POR wait reduced the first target read
  to about 1 retry on the tested board.

## Root Cause

The tested failure is a startup sequencing issue. SW2303 VIN comes from
TPS55288 VOUT, so SW2303 powers up only after TPS has been configured. If the
MCU drives I2C traffic during that interval, SW2303 can hold or perturb SDA and
the shared bus becomes unusable for both TPS55288 and SW2303.

Firmware can improve TPS startup by holding `SDA_TPS/SCL_TPS` released before
I2C peripheral takeover and by using `CE_TPS` only as a TPS hard-start fallback.
After the TPS 5 V setpoint is programmed, firmware must again release
`SDA_TPS/SCL_TPS` through SW2303 POR, then bind the I2C peripheral and start
reading SW2303 target voltage/current.

## Resolution

Use this firmware startup sequence:

1. Configure `SDA_TPS/SCL_TPS` as open-drain release-high before I2C peripheral
   takeover.
2. Hold TPS output off with `CE_TPS` during MCU GPIO setup.
3. Release `CE_TPS`, use TPS55288 `OE` plus active discharge to stop output,
   wait about 1 second, then release and read `SDA_TPS/SCL_TPS`.
4. If the bus is stuck low after discharge, pulse `CE_TPS` once, wait until
   `SDA_TPS/SCL_TPS` are high, then retry TPS boot setup.
5. Program TPS55288 registers before enabling output; make the TPS `OE` write
   the last TPS transaction before the SW2303 POR hold. If this is immediately
   after a hard-start, allow a bounded retry for the first post-POR TPS I2C
   transaction.
6. After TPS 5 V setpoint success, release `SDA_TPS/SCL_TPS` for about 1.005 seconds
   before SW2303 I2C.
7. Poll SW2303 target voltage/current from the structured driver path and keep
   the last valid target if a single read window is missed.
8. Avoid TPS no-op writes when the SW2303 target is still the 5 V boot setpoint;
   only update TPS when SW2303 asks for a higher target voltage.
9. Defer TPS fault/status reads and SW2303 profile writes until SW2303 target
   reads have been stable for a long window.

Guardrails:

- Do not use INA226 to decide whether TPS output is ready for SW2303 access.
- Do not use `CE_TPS` for routine power-path control; prefer TPS55288 `OE`.
- Use `CE_TPS` only for hard restrap/recovery when TPS I2C cannot otherwise
  establish the boot setpoint or when the post-discharge shared bus is stuck
  low.
- Do not force SW2303 pass-path control to make connector output appear.
- Use SW2303 target voltage/current as the PD source control input; do not add
  SW2303-derived connection-state gating.
- Do not replace SW2303 target reads with a burst read unless the register map
  explicitly guarantees auto-increment; the tested burst read returned invalid
  voltage/current values.

## References

- `src/bin/main.rs`
- `src/pd_i2c/tps55288.rs`
- `src/pd_i2c/sw2303.rs`
- `docs/hardware-variants.md`
- `docs/pd-i2c-coordinator-design.md`
- `docs/netlist/tps-sw-checklist.md`
