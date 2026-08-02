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
root_cause: A runtime output-off setpoint could leave TPS discharge disabled, so short cycles did not reliably reset the SW2303 even though firmware reported TPS enabled and I2C allowed.
resolution_type: runtime-state-machine
---

# TPS and SW2303 Runtime Power-Cycle Sequencing

## Context

Runtime output control is non-persistent: it changes TPS55288 output state but
does not change the saved source-capability configuration. A rapid off/on
transition must keep the SW2303 control path in a defined electrical and
software state without relying on recovery retries or a physical replug.

The owner-facing runtime discharge preference is not sufficient to control the
restart safety sequence. The firmware must force discharge only while the
runtime power gate holds TPS output off, then clear it before the 5 V boot
setpoint.

## Evidence

The specified board `f293cc9c139e` was tested through the released host CLI
runtime-output path with the PPS-capable PD sink supplied by the owner. No
hardware was modified.

The failed signature was precise: after a short cycle, firmware reported TPS
output enabled and SW2303 I2C allowed, but SW2303 VBUS was 585 mV, USB-C was
`not_inserted`, and measurement rendering was off. That rules out a display
refresh failure.

With forced discharge during the gate, 50 ms failed and each candidate from 60
through 100 ms passed 20 immediate cycles. The measured `Tmin` is 60 ms; the
production value is therefore 110 ms after adding 50 ms margin and rounding to
10 ms. At 110 ms, 200 immediate cycles passed with runtime discharge disabled
and another 200 passed with it enabled. Every pass produced TPS enabled,
SW2303 I2C allowed, VBUS at least 4.5 V, `usb_c_actual.status=ok`, and visible
measurements within 700 ms.

The bench result also established an important distinction: while TPS output
is off, the unpowered SW2303 can clamp SDA/SCL low. Physical I2C-pin release
cannot be validated by requiring both sampled lines to read high before TPS
boot.

## Resolution

Use a small portable state machine for the runtime sequence:

1. Park GPIO39/GPIO40 as open-drain low with no internal pull and apply a TPS
   output-off setpoint with discharge enabled.
2. Begin the 110 ms off hold only after that TPS write succeeds. Keep a new
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
- Never let the owner-facing runtime discharge preference disable the temporary
  TPS discharge required by this restart guard. Preserve the preference in the
  API and saved configuration; clear the transient bit before boot.
- Do not use line-high sampling of an unpowered SW2303 as a prerequisite for
  TPS boot. It is expected to be low until the TPS path powers the chip.
- Keep the state machine in the `no_std` shared core and test timer/error
  transitions on the host. HIL verdicts must include USB-C telemetry visibility
  and attachment status, not only TPS command success or SW2303 VBUS.
- This is a firmware sequencing rule. It does not require a PCB, schematic,
  BOM, or other hardware change.

## References

- `docs/specs/dzcaw-usb-c-tps-power-config/SPEC.md`
- `crates/isolapurr-firmware-core/src/sw2303_power_gate.rs`
- `src/bin/firmware_main/main_loop_pd.inc`
