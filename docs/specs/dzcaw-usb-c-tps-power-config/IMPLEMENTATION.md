# Implementation

## Firmware

- Added `src/power_config.rs` with SW2303-only config types, validation,
  100 W current limiting, manual voltage/current quantization, and three-state
  USB-C path policy resolution.
- Added EEPROM load/store for a dedicated power-config record with fallback to
  full SW2303 auto-follow defaults.
- Extended API shared state with power config, lock, pending command, persisted
  state, and last SW2303 path control.
- Added HTTP and USB JSONL commands:
  - `power.config_get`
  - `power.config_set`
  - `power.config_defaults`
  - `power.lock`
- Updated the PD/TPS runtime loop so pending config writes are saved, applied,
  reflected in diagnostics, and used for SW2303 profile application.
- Added SW2303 path helpers for automatic control, force-close, and force-open.
- Added GC9307 settings entries for Power Preset and Power Advanced.

## Web

- Added `DevicePowerPage` and `DevicePowerPanel`.
- Extended `device-runtime` and `deviceApi` for HTTP, Web Serial, and Local USB
  power config calls.
- Added host-lock heartbeat handling with per-panel owner IDs.
- Added Storybook coverage for default, auto-follow, host-locked, failure,
  save, restore, and narrow states.
- Fixed narrow responsive layout so the power cap and output mode controls do
  not clip.

## Verification

- `cargo check`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun run build-storybook`
- `cd web && bun run test:unit`
- `cd web && bun run test:storybook`

`cargo test power_config` is not a valid gate for this repository target as
currently configured because the ESP `xtensa-esp32s3-none-elf` target lacks the
standard `test` crate.
