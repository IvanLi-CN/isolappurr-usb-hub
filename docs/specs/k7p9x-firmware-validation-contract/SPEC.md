# Firmware Validation Contract（#k7p9x）

## Background

The repository root is an ESP32-S3 firmware crate configured for the
`xtensa-esp32s3-none-elf` target. That target is valid for firmware builds, but
it does not provide Rust's standard `test` crate. Running `cargo test` at the
root therefore exercises an unsupported host-test path rather than a meaningful
firmware quality gate.

Pure firmware logic still needs fast host-runnable tests. The validation
contract separates target-bound firmware code from portable `no_std` logic so
CI and local development can test shared contracts without pretending the ESP
firmware crate is a host crate.

## Goals

- Define root firmware `cargo test` as unsupported for this repository target.
- Add a host-runnable shared firmware core crate for pure `no_std` logic.
- Keep ESP runtime, drivers, async tasks, hardware access, and HIL behavior in
  the root firmware crate.
- Provide a single local validation entrypoint for firmware build, shared core
  tests, and host-tool tests.
- Keep the existing required GitHub Actions check name while adding shared core
  host tests inside the firmware workflow.
- Document the validation contract in human-facing project docs.

## Non-Goals

- Making the root ESP firmware crate run under `cargo test`.
- Replacing hardware-in-the-loop validation for PD, TPS, SW2303, USB, display,
  Wi-Fi, or EEPROM behavior.
- Moving runtime code that depends on ESP HAL, Embassy networking, I2C devices,
  GC9307 rendering, or transport tasks into the shared core.
- Creating a new CI check name for firmware validation.

## Requirements

- The root `Cargo.toml` MUST keep the ESP32-S3 firmware crate as the default
  workspace member.
- Shared pure logic MUST live in `crates/isolapurr-firmware-core` and remain
  `#![no_std]`.
- The root firmware crate MUST depend on the shared core by path and re-export
  migrated contracts where existing module paths are part of local firmware
  code.
- `just firmware-core-test` MUST run shared core tests with an explicit host
  target resolved from `rustc +stable -vV`.
- `just firmware-check` MUST run the ESP firmware build, shared core tests, and
  host-tool tests.
- `.github/workflows/firmware.yml` MUST run the shared core host tests inside
  the existing `Firmware (ESP32-S3) / build` job.
- Documentation MUST state that root `cargo test` is not a valid firmware gate
  while the default target remains `xtensa-esp32s3-none-elf`.
- Portable tests SHOULD cover config validation, display policy helpers,
  idle-bias math, EEPROM record encoding/decoding, PD I2C request contracts,
  and telemetry derivation when those modules are pure.
- Runtime modules MAY keep root-only tests when extracting them would require
  moving target-bound HTTP, networking, or hardware code.

## Acceptance

- Given the repository root, when `cargo build --release` runs, then the ESP
  firmware build completes for the configured target.
- Given the shared core manifest, when
  `cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$host"`
  runs with the current host triple, then all shared core tests pass.
- Given local firmware validation, when `just firmware-check` runs, then it
  executes `just build`, `just firmware-core-test`, and `just host-tools-test`.
- Given CI firmware validation, when the existing firmware workflow build job
  runs, then it runs shared core host tests before the firmware build without
  changing the required check name.
- Given docs or implementation notes mention firmware testing, when they refer
  to root `cargo test`, then they identify it as unsupported rather than a
  valid acceptance gate.

## Milestones

- [x] Workspace and shared core crate structure.
- [x] Shared core host test entrypoint.
- [x] Root firmware re-exports for migrated pure contracts.
- [x] Firmware workflow shared core host-test step.
- [x] Project and reusable knowledge documentation.

## Risks And Open Questions

- Root-only HTTP JSON and mDNS response tests still cover target-bound modules.
  They should be extracted only after a smaller portable API/encoding boundary
  is designed.
- Hardware behavior remains outside the shared core; HIL is still required for
  PD negotiation, TPS/SW2303 behavior, EEPROM buses, display output, USB
  transport, and Wi-Fi/networking.
