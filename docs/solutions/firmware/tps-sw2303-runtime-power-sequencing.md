---
title: TPS and SW2303 runtime power-cycle sequencing
module: firmware
problem_type: power-state-transition
component: tps55288-sw2303
tags:
  - firmware
  - tps55288
  - sw2303
  - i2c
  - power-cycle
status: active
related_specs:
  - dzcaw
symptoms:
  - A short runtime TPS output off/on cycle can leave the USB-C sink without output.
  - Repeated power actions can eventually recover output without changing the saved configuration.
root_cause: The restart sequence could expose SW2303 I2C transactions before a deterministic TPS-off interval and before its TPS boot/POR sequence had completed.
resolution_type: runtime-state-machine
---

# TPS and SW2303 Runtime Power-Cycle Sequencing

## Context

Runtime output control is non-persistent: it changes TPS55288 output state but
does not change the saved source-capability configuration. A rapid off/on
transition must keep the SW2303 control path in a defined electrical and
software state without relying on recovery retries or a physical replug.

## Evidence

The specified board `f293cc9c139e` was tested with its existing 5.1 kOhm sink
through the released host CLI runtime-output path. No other hardware was
connected, changed, or operated.

For both `discharge=false` and `discharge=true`, candidates
`0/10/25/50/100/200/500 ms` each completed 20 consecutive off/on cycles. A
cycle passed when, within 3 seconds, diagnostics reported TPS output enabled,
SW2303 I2C allowed, and SW2303 VBUS at least 4.5 V. The first full-pass
candidate was 0 ms for both states. The final source value is therefore 50 ms:
`max(Tmin_discharge_off, Tmin_discharge_on) + 50 ms`, rounded to 10 ms.

At the final 50 ms value, 200 cycles passed with discharge disabled and 200
cycles passed with discharge enabled. The maximum observed VBUS-ready time was
300 ms. No cycle used runtime recovery, replugging, or manual intervention.

The bench result also established an important distinction: while TPS output
is off, the unpowered SW2303 can clamp SDA/SCL low. Physical I2C-pin release
cannot be validated by requiring both sampled lines to read high before TPS
boot.

## Resolution

Use a small portable state machine for the runtime sequence:

1. Park GPIO39/GPIO40 as open-drain low with no internal pull and apply the
   TPS output-off setpoint.
2. Begin the 50 ms off hold only after that TPS write succeeds. Keep a new
   output-on request pending during the hold.
3. Release the GPIO pins physically after the hold, but do not allow an I2C
   transaction yet.
4. Apply the TPS 5 V boot setpoint, then wait the independent 100 ms SW2303
   POR interval.
5. Enable SW2303 I2C access only after POR and resume profile/configuration
   work normally.

TPS write errors retain the existing error-latch behavior. They do not advance
either timer or fabricate a successful runtime-output response.

## Guardrails / Reuse Notes

- Keep the measured TPS off hold separate from `SW2303_POR_RELEASE_MS`; the
  former is a runtime restart guard, while the latter starts only after TPS 5 V
  boot application.
- Do not use line-high sampling of an unpowered SW2303 as a prerequisite for
  TPS boot. It is expected to be low until the TPS path powers the chip.
- Keep the state machine in the `no_std` shared core and test timer/error
  transitions on the host. Verify electrical output and diagnostics with HIL.
- This is a firmware sequencing rule. It does not require a PCB, schematic,
  BOM, or other hardware change.

## References

- `docs/specs/dzcaw-usb-c-tps-power-config/SPEC.md`
- `crates/isolapurr-firmware-core/src/sw2303_power_gate.rs`
- `src/bin/firmware_main/main_loop_pd.inc`
