# History

## 2026-06-03

- Added the SW2303-only power configuration topic.
- Chose whole-config transactions to avoid partial protocol/current/path state.
- Kept SW2305 and VOOC as reserved future schema space, not runtime support.
- Bound manual USB-C path control to explicit mode and SW2303 request checks.
- Added Web, USB JSONL, Local USB, and on-device GC9307 control surfaces.
- Captured Storybook canvas visual evidence for desktop and narrow layouts.

## 2026-06-10

- Added `CC` and `DPDM` negotiation badges to the Web power protocol cards.
- Hid negotiation badges on narrow cards with card-level container queries to
  preserve responsive readability.
- Extended Storybook/spec evidence to cover badge visibility on wide, narrow,
  and constrained medium-width protocol cards.

## 2026-06-11

- Added a device-level USB-C idle-bias calibration topic to the existing
  SW2303 power-config flow instead of burying it inside the power-config EEPROM
  schema.
- Split USB-C telemetry into corrected main output data plus preserved raw
  INA226 diagnostics.
- Added MCU async sweep execution, EEPROM persistence, bridge/CLI/Web
  contracts, and Storybook evidence for uncalibrated, applied, running,
  confirmation, and failure states.

## 2026-06-12

- Refined the Dashboard USB-C badge contract so live badges hide the legacy
  status chip only when USB-C telemetry resolves cleanly.
- Kept the legacy USB-C status chip visible for firmware without PD
  diagnostics and for real USB-C telemetry errors.
- Refreshed Dashboard visual evidence and added dedicated regression captures
  for the legacy no-diagnostics and telemetry-error states.
- Fixed the MCU idle-bias sweep so successful or failed calibration restores
  the pre-run runtime output configuration instead of leaving the final sweep
  voltage active.
- Changed each idle-bias sweep point to hold for about `1 s`, using the first
  `500 ms` as settle time and averaging multiple samples over the final
  `500 ms`.
