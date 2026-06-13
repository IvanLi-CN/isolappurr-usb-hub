# Implementation

## Firmware Core

- Added `crates/isolapurr-firmware-core` as a `#![no_std]` workspace crate.
- Moved portable contracts into the shared core:
  - power configuration validation and path policy
  - normal UI display policy helpers
  - USB-C display mode and presence helpers
  - idle-bias metadata, interpolation, and corrected telemetry math
  - PD I2C request/setpoint types
  - telemetry snapshot and U17/R29 INA226 derivation helpers
  - power-config and idle-bias EEPROM record encoding/decoding with checksum
    guards
- Kept root firmware modules as compatibility re-exports for migrated contracts
  so existing runtime code can continue using current module paths.
- Left target-bound runtime code in the root firmware crate, including ESP HAL
  setup, async tasks, I2C transactions, display rendering, Wi-Fi, HTTP, mDNS,
  Local USB, and HIL-facing behavior.

## Validation Entrypoints

- Added `just firmware-core-test`, which resolves the host triple from
  `rustc +stable -vV` and runs shared core tests with an explicit `--target`.
- Added `just firmware-check`, which runs:
  - `just build`
  - `just firmware-core-test`
  - `just host-tools-test`
- Added a shared core host-test step to `.github/workflows/firmware.yml` inside
  the existing firmware build job so required check names stay stable.

## Project Documentation

- Updated README and AGENTS guidance to make `just firmware-check` the local
  firmware validation entrypoint.
- Documented that root `cargo test` is unsupported while the repository default
  target is `xtensa-esp32s3-none-elf`.
- Added a reusable solution for future `no_std` firmware host-test extraction.
- Refreshed the USB-C TPS power-config implementation note to point at the
  shared core test path for migrated pure logic.

## Verification

- `cargo +stable fmt --all -- --check`
- `cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$(rustc +stable -vV | sed -n 's/^host: //p')"`
- `cargo build --release`

## Remaining Boundaries

- Root `src/mdns.rs` still contains tests around mDNS name and response
  helpers. Extracting them should happen through a deliberate portable encoder
  boundary instead of moving the network task wholesale.
- Root `src/net.rs` still contains tests around HTTP JSON output. Extracting
  them should happen only after the API snapshot and JSON writer boundary is
  split from target-bound HTTP runtime code.
