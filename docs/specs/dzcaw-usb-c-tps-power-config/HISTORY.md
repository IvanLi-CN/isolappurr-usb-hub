# History

## 2026-06-29

- Added persisted manual cable-compensation and auto-follow line-compensation
  settings without changing the EEPROM record length.
- Locked the runtime rule that `auto_follow` uses SW2303 line compensation and
  forces TPS cable compensation off, while `manual` does the opposite.
- Collapsed SW2303 register `0x14`, `0xA4`, and `0xAD bit7` into one
  owner-facing setting and documented why the current board must not expose TPS
  external CDC mode.

## 2026-06-19

- Shrunk the Web protocol matrix so the capability area stays compact and
  card-first instead of spending vertical space on a second switch control.
- Changed Web protocol cards to toggle directly on click, while moving all
  persisted protocol-specific current and high-voltage options into inline
  compact selectors.
- Exposed the previously hardcoded SW2303 current and fast-charge axes through
  firmware, HTTP/USB JSONL, Web, and owner CLI so read/modify/write flows no
  longer drop those settings.
- Added live `active_protocol` diagnostics and used that signal to highlight
  the currently negotiated protocol separately from merely enabled protocols.
- Tightened the bright-theme success badge contrast, moved protocol option
  menus out of the clipped card stacking context, and restored touch-safe
  protocol controls on narrow screens without undoing the compact desktop
  layout.

## 2026-06-21

- Formalized the warm-amber `secondary` theme token as the Web informational
  highlight for the live active protocol instead of reusing success semantics.
- Added a `Brand/ThemePalette` Storybook review surface so the light/dark token
  palette and active-card emphasis can be audited in one stable place.
- Unified dashboard, device-card, demo-sheet, port-card, idle-bias summary,
  and toast semantic badges around bordered state surfaces so both themes keep
  a cleaner hierarchy between live emphasis and success status.

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

## 2026-06-16

- Clarified that PD diagnostics `tps_setpoint.iout_limit_ma` means the applied
  TPS55288 `IOUT_LIMIT` output current limit, not the `ILIM` pin's average
  inductor-current limit.
- Added `tps_iout_limit_readback` so HIL can verify CLI/Web write-paths
  against the live TPS register state.
- Aligned LAN CLI power commands with owner-facing bare-host URLs by
  normalizing them to `http://...` API bases.
- Reconfirmed current-limit behavior on `f293cc9c139e @ 192.168.31.224` with
  LoadLynx CV loading: both CLI/devd and Web/LAN paths held the 3 A limit
  correctly under real load once the extra external supply was removed.

## 2026-06-17

- Extended the Dashboard USB-C card header to show the live TPS
  `IOUT_LIMIT` output current limit as a dedicated `x.xx A` badge when
  diagnostics provide `tps_setpoint.iout_limit_ma`.
- Kept the existing mode/setpoint and `FOCUS` / `ON` / `OFF` live badges,
  but stopped treating the header as a strict two-badge contract.
- Added Storybook regression coverage for both the rendered current-limit
  badge and the hidden-when-missing fallback.
- Bound the power surface to the new repository Web demo-surface policy so the
  topic now explicitly relies on production `/devices/:deviceId/power` proof,
  composite Storybook stories, and spec-owned visual evidence instead of any
  dedicated power demo page.
- Split the Power surface into a runtime-only output gate backed by TPS55288
  `OE` plus an advanced `DISCHG` control for the TPS output-off state.
- Added a manual high-voltage warning that explicitly says SW2303 can still
  heat under manual high-voltage operation and recommends `auto_follow` for
  sustained use.
- Kept the new runtime controls non-persistent and wired them through the Web,
  owner CLI, and firmware runtime snapshots.
- Reworked the owner-facing Web wording and layout so the live USB-C
  telemetry plus `Power` / `Replug` actions now sit in the right rail, and the
  old `2mm Output` page label is no longer presented as a standalone setting.
