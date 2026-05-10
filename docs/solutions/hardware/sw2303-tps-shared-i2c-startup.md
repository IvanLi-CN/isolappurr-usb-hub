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
  - Shorter SW2303 POR holds can show transitional target values before settling to the negotiated 7 V request.
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
  `SDA_TPS/SCL_TPS` can both read low; record this as a shared-bus stuck-low
  indication, but let the first TPS boot transaction decide whether CE recovery
  is actually needed.
- A `CE_TPS` hard-start can restore the bus when the shared bus is stuck low;
  on the tested board the lines returned high after a few hundred milliseconds
  of recovery polling.
- If the MCU starts I2C traffic while SW2303 is still in its POR window, the
  shared bus can fail with `SW2303(0x3C)` read timeouts.
- With `SDA_TPS/SCL_TPS` released through the SW2303 POR window, logs show
  `sda_high=true scl_high=true` before the first SW2303 target read.
- A shorter POR wait can still work, but the first visible SW2303 targets may
  step through intermediate values such as `5V/3A`, `5V/3.25A`, or
  `5.53V/1A` before settling at the negotiated `7V/1A`.
- A 100 ms POR hold was stable in long-run testing and still let the first
  SW2303 read settle to `7V/1A` on the tested board.
- A 500 ms or 800 ms POR hold also worked, but did not improve the final
  target-read behavior enough to justify the extra wait.
- On the repaired board, eight `monitor --from-start --reset` samples showed
  that trying TPS boot I2C before CE recovery is wasted work: every sample
  timed out on the first TPS boot I2C transaction and only succeeded after
  CE-backed recovery. The boot flow should therefore recover a stuck-low
  shared bus before TPS boot I2C.
- After removing the direct short-path attempt, eight reset samples succeeded
  with `path=ce_recovered_before_tps_and_retry`: firmware recovered the
  post-discharge stuck-low bus before TPS boot I2C, ran one more CE recovery
  after the first TPS I2C timeout, and then applied the 5 V boot setpoint on
  attempt 3/4 in every sample.

## Root Cause

The tested failure is a startup sequencing issue. SW2303 VIN comes from
TPS55288 VOUT, so SW2303 powers up only after TPS has been configured. If the
MCU drives I2C traffic during that interval, SW2303 can hold or perturb SDA and
the shared bus becomes unusable for both TPS55288 and SW2303.

Firmware can improve TPS startup by holding `SDA_TPS/SCL_TPS` released before
I2C peripheral takeover and by using `CE_TPS` as a TPS hard-start fallback when
the shared bus is stuck low after discharge.
After the TPS 5 V setpoint is programmed, firmware must again release
`SDA_TPS/SCL_TPS` through SW2303 POR, then bind the I2C peripheral and start
reading SW2303 target voltage/current. The apparent SW2303 "ramp" in target
reads is normal and should be treated as part of its own control loop, not as a
failure signal.

## Resolution

Use this firmware startup sequence:

1. Configure `SDA_TPS/SCL_TPS` as open-drain release-high before I2C peripheral
   takeover.
2. Hold TPS output off with `CE_TPS` during MCU GPIO setup.
3. Release `CE_TPS`, use TPS55288 `OE` plus active discharge to stop output,
   wait about 1 second, then release and read `SDA_TPS/SCL_TPS`.
4. If the released bus is stuck low after discharge, pulse `CE_TPS` and poll
   until both `SDA_TPS/SCL_TPS` are high before attempting TPS boot I2C. If
   either line remains low after the polling window, repeat the CE recovery
   cycle instead of starting TPS I2C on a non-idle bus. Keep a boot-path
   summary log so tests can distinguish direct boot from CE-backed recovery.
5. Program TPS55288 registers before enabling output; make the TPS `OE` write
   the last TPS transaction before the SW2303 POR hold. If this is immediately
   after a hard-start, allow a bounded retry for the first post-POR TPS I2C
   transaction.
   If the first TPS boot transaction still fails after the pre-boot CE
   recovery, run one more CE recovery before consuming the remaining TPS boot
   retries.
6. After TPS 5 V setpoint success, release `SDA_TPS/SCL_TPS` for about 100 ms
   before SW2303 I2C on the tested board; longer holds worked too, but did not
   improve the observed final SW2303 behavior.
7. Poll SW2303 target voltage/current from the structured driver path and keep
   the last valid target if a single read window is missed.
8. Avoid TPS no-op writes when the SW2303 target is still the 5 V boot setpoint;
   only update TPS when SW2303 asks for a higher target voltage.
9. Defer TPS fault/status reads and SW2303 profile writes until SW2303 target
   reads have been stable for a long window.

Guardrails:

- Do not use INA226 to decide whether TPS output is ready for SW2303 access.
- Do not use `CE_TPS` for routine power-path control; prefer TPS55288 `OE`.
- Use `CE_TPS` only for hard restrap/recovery when the released shared bus is
  stuck low before TPS boot I2C; do not start TPS I2C until both lines are high
  or the bounded recovery cycles have been exhausted.
- Do not force SW2303 pass-path control to make connector output appear.
- Use SW2303 target voltage/current as the PD source control input; do not add
  SW2303-derived connection-state gating.
- Do not replace SW2303 target reads with a burst read unless the register map
  explicitly guarantees auto-increment; the tested burst read returned invalid
  voltage/current values.
- Treat early SW2303 target transitions as expected behavior if the bus stays
  readable and the values converge to the negotiated request.

## References

- `src/bin/main.rs`
- `src/pd_i2c/tps55288.rs`
- `src/pd_i2c/sw2303.rs`
- `docs/solutions/hardware/usb-c-sink-output-verification.md`
- `docs/hardware-variants.md`
- `docs/pd-i2c-coordinator-design.md`
- `docs/netlist/tps-sw-checklist.md`
