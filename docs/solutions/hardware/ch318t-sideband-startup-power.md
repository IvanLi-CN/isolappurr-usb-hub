---
title: CH318T sideband cannot recover a missing host-device link
module: hardware
problem_type: hardware-debug
component: ch318t-upstream-link
tags:
  - ch318t
  - usb
  - sideband
  - startup
  - isolated-power
status: active
related_specs:
  - docs/specs/6xrna-ch318-ledd-upstream-link/SPEC.md
symptoms:
  - CH318T upstream and downstream LEDs stay off when host-side power is present without a valid USB Host signal.
  - The target downstream hub does not enumerate under the host-side CH318T hub.
  - MCU drives PU_CE low, but PU_CED can remain high and keep U18 CH442E disabled.
  - Toggling PU_CE from the downstream MCU side does not restore communication after the CH318T pair failed to establish the link.
root_cause: CH318T IO2 sideband propagation depends on the CH318T pair having an established link, so it cannot be used as a recovery channel when host-device USB communication never came up.
resolution_type: hardware-architecture
---

# CH318T Sideband Startup And Power Sequencing

## Context

The `tps-sw` upstream USB2.0 data path uses `U18(CH442E)` as the host-side data
switch. `U18.EN#` is connected to `PU_CED`, which is driven by `U1(CH318T) IO2`
on the host side. The downstream MCU drives `PU_CE` into `U2(CH318T) IO2`, and
the previous firmware assumption was that CH318T sideband mapping would carry
that logic level to `PU_CED`.

That assumption is only useful after the CH318T pair is already communicating.
It is not a reliable recovery path for the failure where the CH318T pair never
establishes the host-device USB link.

## Symptoms

- `PU_CE` can be driven low by the MCU while `PU_CED` remains high.
- `PU_CED=High` makes `U18.EN#=High`, disabling the CH442E upstream USB2.0
  switch.
- With `U18` disabled, the host sees only the host-side CH318T hub and does not
  enumerate the downstream target hub/device.
- If the host-side connector is powered but does not provide a valid USB Host
  signal, both CH318T link LEDs stay off.
- When the downstream side is powered too late relative to an already-powered
  host-side computer, the CH318T pair can miss the startup window and remain
  unable to communicate.
- Toggling `PU_CE` from the downstream MCU side does not recover the link once
  sideband propagation is unavailable.

## Root Cause

CH318T sideband signals are auxiliary GPIO-level signals transported by the
CH318T link. They are not an independent out-of-band control path. When the
host and downstream CH318T chips have not established USB communication, the
downstream-side MCU cannot depend on `PU_CE -> PU_CED` propagation to control
the host-side CH442E switch.

This creates a circular dependency:

1. `PU_CED` must be low for `U18` to connect the host-side USB data path.
2. The downstream MCU can only directly drive `PU_CE`, not `PU_CED`.
3. `PU_CE` reaches `PU_CED` only if the CH318T sideband path is functioning.
4. The sideband path is not functioning when the CH318T pair never established
   the host-device USB link.

Therefore the downstream firmware cannot reliably restore this class of
failure by toggling `PU_CE`.

## Resolution

For the old switched upstream path, the temporary mitigation was:

- Firmware kept `PU_CE` low, and did not use it as a periodic or conditional
  recovery toggle for production behavior.
- Treat `PU_CED=High` as a host-side hardware/control-state failure that keeps
  `U18` disconnected.
- Do not rely on EEPROM-configured `PU_CE` recovery, button-driven `PU_CE`
  recovery, LEDD-triggered recovery, or timed startup toggles as the final fix.
- Use `LEDD` only as an indication input; it cannot prove that sideband
  recovery is available.

For the direct upstream path:

- Remove `U18` and short the upstream USB data path in hardware.
- Do not initialize or drive `GPIO36/PU_CE` in firmware.
- Keep `LEDD` as a high-impedance active-low status input only.

For the next hardware revision:

- Provide an isolated 3.3 V supply for the downstream CH318T side so it is
  already powered when the host-side USB Host connection appears.
- Design the startup sequence so both CH318T sides are ready within the host
  connection window.
- Ensure the host-side `U18.EN#` default state is fail-connected, or give the
  MCU a direct, non-sideband control path to that enable signal if firmware
  control is required.
- Avoid making host-side connection enable depend on a sideband signal that is
  available only after the CH318T link is already healthy.

## Guardrails / Reuse Notes

- Always measure both `PU_CE` and `PU_CED`; `PU_CE=Low` does not imply
  `PU_CED=Low`.
- If `PU_CED=High`, `U18` is disabled regardless of MCU intent.
- If host-side power is present without a valid USB Host signal and both CH318T
  LEDs stay off, do not expect sideband propagation to work.
- Do not classify a host-side CH318T hub enumeration alone as proof that the
  downstream CH318T link is healthy. The downstream target hub/device must also
  enumerate under it.
- The robust fix is power-sequencing and default-state design, not firmware
  retries from the downstream side.

## References

- `docs/datasheets/ch318t-datasheet.md`
- `docs/netlist/tps-sw-checklist.md`
- `docs/specs/6xrna-ch318-ledd-upstream-link/SPEC.md`
- `hardware/tps-sw/netlist.enet`
