---
title: no_std firmware shared core host tests
module: firmware
problem_type: validation-contract
component: rust-no-std
tags:
  - firmware
  - no_std
  - rust
  - testing
  - ci
status: active
related_specs:
  - k7p9x
symptoms:
  - Root `cargo test` fails because the configured firmware target does not provide Rust's standard test crate.
  - Pure firmware helper regressions need fast local and CI feedback without flashing hardware.
root_cause: The root firmware crate targets ESP32-S3 `no_std` firmware, so host tests must be run from a separate portable crate or with an explicit host target boundary.
resolution_type: validation-boundary
---

# no_std Firmware Shared Core Host Tests

## Context

ESP firmware crates often set the repository default target to an embedded
target. That makes `cargo build` meaningful for firmware, but it also means
root `cargo test` can fail before exercising any project logic because the
target lacks the standard Rust test harness.

For IsolaPurr, the root target is `xtensa-esp32s3-none-elf`. Treat root
`cargo test` as unsupported unless the firmware crate is deliberately
reconfigured for host testing.

## Symptoms

- `cargo test` at the repository root errors on the firmware target before
  running the intended unit tests.
- Review or CI discussions start treating that error as a product regression,
  even though it is a validation contract mismatch.
- Pure logic such as config validation, display policy, telemetry math, or
  EEPROM record encoding has tests that do not actually need ESP hardware.

## Root Cause

The firmware root crate combines portable logic with target-bound runtime code.
The target-bound part depends on embedded runtime, HAL, async hardware tasks,
and device drivers. The portable part can be tested on the host, but only if it
is placed behind a clean crate boundary that does not pull in ESP-only runtime
dependencies.

## Resolution

Use a shared `#![no_std]` core crate for pure contracts:

- Put portable modules in `crates/isolapurr-firmware-core`.
- Keep ESP runtime, hardware access, transport tasks, display flushing, and HIL
  behavior in the root firmware crate.
- Make the root firmware crate depend on the core crate and re-export migrated
  modules when local paths need to stay stable.
- Run core tests with an explicit host target:

```sh
host="$(rustc +stable -vV | sed -n 's/^host: //p')"
cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$host"
```

- Provide one local firmware validation command that combines firmware build,
  core host tests, and host-tool tests:

```sh
just firmware-check
```

- Keep CI check names stable by adding the core host-test step inside the
  existing firmware workflow job.

## Guardrails / Reuse Notes

- Do not describe root `cargo test` as a valid gate while the default target is
  the embedded firmware target.
- Do not move HAL, Embassy networking, I2C transactions, GC9307 rendering, USB
  serial, or HIL logic into the shared core just to make tests run.
- Extract root-only tests only after identifying a small portable boundary,
  such as an encoder, policy function, value model, or parser.
- Keep hardware claims out of shared core tests. Use HIL or targeted manual
  verification for PD negotiation, TPS/SW2303 behavior, EEPROM buses, display
  rendering, USB transport, and Wi-Fi/networking.

## References

- `docs/specs/k7p9x-firmware-validation-contract/SPEC.md`
- `crates/isolapurr-firmware-core/Cargo.toml`
- `Justfile`
- `.github/workflows/firmware.yml`
