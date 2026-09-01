# Implementation

The shared admission, discovery, safe-mismatch transport, profile build gate,
catalog compatibility validation, and host post-flash checks are implemented.
The `tps-fusb` power/PD runtime remains behind the HIL gate described below:
its VBUS gate is held disabled until the electrical and protocol evidence is
available. No hardware marker is used at any stage.

## Phase 0: Hardware Admission Gates

- Read U17 INA226 manufacturer/die IDs on both board samples before TPS output
  is enabled. Record the exact accepted production values and reject every
  other result.
- Verify both FUSB302B family IDs on `tps-fusb`, including repeated reads on
  I2C0 and I2C1 while all power controls are inactive.
- Scope GPIO2/4/5/15/16/34/35/36/37/47 during reset, USB download mode,
  brownout, watchdog reset, and the first application instructions. Confirm
  PMOS active enhancement, USB-A power, CH442E data paths, TPS enable, and
  output VBUS gate stay inactive where required. Record the route observed
  while GPIO2/4/5 are still under their external default pull-downs; the
  application safe vector is not evidence about that earlier interval.
- Scope the U3 3.3 V cold-start rail on both boards. A build that cannot reach
  `BootSafety` before any profile-specific controller runs is rejected, even if
  its later GPIO vector would have been safe.
- Confirm that each profile's `esp_hal` Flash/PSRAM configuration reaches
  `BootSafety`; a panic or reset before the safe vector is an admission failure.
- Do not substitute board-info, MAC, Flash size, PSRAM size, USB VID/PID, a
  silkscreen reading, or EEPROM content for these checks.

## Phase 1: Build and Shared Core

1. Introduce exactly-one board Cargo feature, for example `board_tps_sw` and
   `board_tps_fusb`. Make `build.rs` reject zero or multiple board features and
   publish the selected compiled profile as build metadata.
2. Give each build a separate target directory and artifact basename so one
   board's ELF/bin cannot overwrite the other during CI or release generation.
3. Add pure, host-testable types under `crates/isolapurr-firmware-core/` for:
   `HardwareProfile`, `DiscoveryState`, `EvidenceObservation`,
   `HardwareDiscoveryV1`, `Compatibility`, and the catalog compatibility rule.
4. Add a board-neutral firmware module for `BootSafety` and a bounded
   `TopologyDetector`. Its platform adapter owns only GPIO8/9/39/40 and the
   named read-only transactions.
5. Add profile-specific `DataRouteController` maps for GPIO2/4/5. Both maps
   share the disabled vector but not route-selection semantics; make the type
   unavailable to the mismatch runtime.
6. Add test fixtures for full FUSB, full SW, partial FUSB, no devices, bus
   fault, wrong INA IDs, both vectors, malformed response, and retry timeout.

## Phase 2: Refactor `tps-sw` Without Behavioral Expansion

1. Split `src/bin/firmware_main/main_runtime.inc` into a shared admission path
   and a `tps_sw` runtime. Move the current normal port state, SW2303 gate,
   TPS boot setpoint, telemetry, display, UI, and network startup behind the
   matching-profile check.
2. Replace the current hard-coded `variant: "tps-sw"` HTTP and USB JSONL
   responses with the versioned discovery response and compiled profile fields.
3. Keep the existing SW2303 persistence format as a `tps-sw` record. Test that
   a `tps-fusb` build neither reads nor writes it as a FUSB policy.
4. Retain the current successful `tps-sw` normal runtime only after the new
   discovery gate passes. Its HIL regression includes regular PD, telemetry,
   display, provisioning, and its U7/U8 port-routing behavior.

## Phase 3: Public `fusb302` Dependency Boundary

1. Land and release a public `fusb302` API extension for host-current choice
   and VBUS comparator/MDAC measurement. It includes docs and mock tests in
   the crate repository.
2. Add the released crate version with its async feature to this repository.
   No project module imports raw FUSB register addresses or masks.
3. Write thin I2C adapters for U10/I2C0 and U11/I2C1; each adapter has a
   profile-specific static allowlist and bounded transaction timeout.
4. Add a task-context interrupt coordinator for GPIO7/38. It identifies the
   source by reading only the devices assigned to that interrupt and bus;
   clear-on-read FUSB interrupt access is not used by discovery.

## Phase 4: `tps-fusb` Power and PD Runtime

1. Implement `InputPowerSelector` as the sole GPIO34/35 owner. It receives
   filtered DC ADC readings and Sink-PD measurements/contract state, emits
   `Off`, `DCActive`, `USBActive`, or `Fault`, and cannot skip the 5 ms
   break-before-make delay.
2. Implement U10 Sink Type-C/PD policy. Its unavailable, detached, timeout,
   measurement conflict, and contract-loss outputs make the selector return to
   `Off`.
3. Implement `TpsCoordinator` as the sole U14/GPIO37 owner and
   `VbusGateController` as the sole GPIO36 owner. They expose a narrow request
   interface, not raw GPIO access.
4. Implement U11 Source in stages. The first enabled state is protected 5 V
   default-current Type-C / PD behavior. It checks external `VBUS_TPS` before
   enabling TPS or the PMOS, sequences attach, source capabilities, request,
   VBUS stability, reset, detach, and fault shutdown.
5. Add profiles for higher Fixed PDOs, 1.5 A/3 A Rp, PD 3.0, and PPS only as
   independently gated capabilities. The initial config schema contains no
   toggle for an unvalidated capability.
6. Implement the `tps-fusb` U7/U8 data-route map as a separate module and HIL
   it for every enabled/disabled route. It must not inherit the existing
   `tps-sw` assumption that `P1_ESP=High` selects the USB-C/TPS route.

## Phase 5: API, Catalog, and Host Tools

1. Extend firmware HTTP `GET /api/v1/info` and USB JSONL `info` with
   `hardwareDiscovery`, `compiledProfile`, `compatibility`, and
   `hardwareCapabilities`. Make mismatch/unknown endpoints read-only.
2. Introduce catalog schema v2 with per-artifact `compatibleHardware`; update
   the generator, bundle builder, Rust structs, TypeScript parser, fixture
   catalog, and schema validation tests.
3. Centralize Local USB preflight in `tools/isolapurr-host`: normal `info`
   first, RAM-only probe only as fallback, profile-compatible artifact lookup,
   then identity validation and flash. The fallback invokes `espflash flash
   --ram --no-stub` only when `ISOLAPURR_BOARD_TOPOLOGY_PROBE` names the
   separately built probe ELF; an absent probe is a hard no-write failure.
4. Run post-flash revalidation for normal and recovery operations. A write is
   not reported as a compatible update until the re-opened firmware reports a
   verified match.
5. Route CLI through the devd implementation. Update all devd HTTP/IPC
   flash endpoints, dry-run diagnostics, human-readable CLI rendering, and
   machine JSON output to carry the discovery result.
6. Update Web Local USB and Web Serial flows to display the detected profile,
   reject catalog/profile mismatches, and preserve the selected-port rule.
   Direct Web Serial RAM probing remains fail-closed until the browser-side
   `esptool-js` RAM-load path is validated against the same probe ELF. A board
   with no running `info` therefore cannot be guessed from chip, MAC, Flash,
   PSRAM, USB VID/PID, or a negative observation.
7. Update or block `desktop/src-tauri/src/app/serial_firmware.rs` paths that
   could write a generic app image without the same compatibility preflight.

## Phase 6: Release and Validation

1. Build both profiles in `Justfile`, firmware CI, release CI, and the web
   bundle. Generate normal and recovery assets for both profiles, each with a
   schema-v2 compatibility declaration.
2. Add source-structure and catalog contract tests so a generic-only artifact,
   a hard-coded `variant`, an unsupported catalog schema, or a flash path that
   lacks post-flash validation fails CI.
3. Run host/core unit tests for all logic and compile both firmware profiles.
   Use the shared testbox only for required heavy integration suites.
4. Perform HIL across both boards: matching boot, wrong-image boot, unknown
   evidence, conflicting evidence, recovery probe, normal update, recovery
   update, reset/download safety (including U3, USB-A power, and CH442E data
   routes), input transitions, Source fault paths, and Sink contract loss.
5. Update the owning CLI/devd specification and user workflow documentation
   together with the released contract. Do not announce `tps-fusb` Source or
   automatic recovery as supported until the corresponding HIL gate passes.
