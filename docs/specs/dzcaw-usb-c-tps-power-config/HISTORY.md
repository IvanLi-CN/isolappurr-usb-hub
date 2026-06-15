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

## 2026-06-15

- Split TPS terminology so `tps_mode` now means only
  `auto_follow|manual`, while the persisted light-load switching policy lives
  in a new top-level `light_load_mode=pfm|fpwm`.
- Reused the existing power EEPROM record reserved byte for
  `light_load_mode`, keeping the saved power-config record length compatible
  and decoding legacy records as `pfm` without a wipe.
- Added immediate TPS55288 `MODE` register application for saved
  `light_load_mode`, including `power defaults` and `settings.reset other`
  fallback to `pfm`.
- Added Web Power settings and released CLI `isolapurr power config show|set`
  coverage for the unified saved power-config surface.
- HIL on device `856a141cdbd4` exposed and then cleared a Local USB transport
  regression: the whole-config `power.config_set` JSONL frame no longer fit the
  old `512`-byte firmware line buffer once `light_load_mode` joined the saved
  payload, so the firmware USB console buffer was raised to `1024` bytes.
- Tightened `power.config_set` / `power.config_defaults` response consistency
  so `manual.path_policy` no longer briefly falls back to `unknown` before the
  runtime SW2303 path snapshot catches up.
- Fixed the Web save path so `PUT /power/config` no longer echoes read-only
  `manual.path_policy` back to the device, which had blocked live page saves
  even though the persisted `light_load_mode` transport contract itself was
  already correct.
- Added a live Playwright HIL regression that drives the built Web power page
  against `isolapurr-devd bridge-http`, saves `PFM -> FPWM -> PFM`, and proves
  bridge readback stays aligned with what the operator sees after page reload.
