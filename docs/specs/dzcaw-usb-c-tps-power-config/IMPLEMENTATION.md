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
- Refined manual `default` path control so sub-5 V manual output still keeps
  the SW2303 path in `auto` when no explicit protocol request exists, matching
  the Type-C 5 V fallback behavior for passive CC sinks.
- Added GC9307 settings entries for Power Preset and Power Advanced.
- Added `src/idle_bias.rs` with fixed metadata, 37-point offset storage,
  voltage-based interpolation, corrected current clamp, and corrected power
  recomputation helpers.
- Added a dedicated idle-bias EEPROM record with metadata/version/CRC guards so
  missing or corrupt data boots as `dataset missing` with correction disabled.
- Split USB-C runtime telemetry into `raw` and `corrected` views so the main
  API/UI path stays corrected while diagnostics keep the original INA226 values.
- Added MCU-side idle-bias async job handling for `run`, `set correction`, and
  `clear`, including attach checks, temporary sweep-mode TPS control, all-or-
  nothing EEPROM save behavior, reset-path cleanup, restoration of the
  pre-calibration runtime power state, and a `500 ms` settle plus `500 ms`
  averaging window at every sweep point.
- Extended `settings.reset scope=other` so it also clears the idle-bias EEPROM
  record and forces correction off.

## Host / CLI

- Added bridge and Local USB/JSONL contracts for:
  - `power.idle_bias_get`
  - `power.idle_bias_set`
  - `power.idle_bias_run`
  - `power.idle_bias_clear`
- Added device bridge HTTP routes for `/power/idle-bias`, `/run`, and `/clear`.
- Added `isolapurr power idle-bias show|run|clear|set --enabled <bool>` with
  interactive confirmation and `--yes` bypass handling.
- Updated human CLI output so the main USB-C reading stays corrected while
  `--json` preserves both corrected telemetry and the raw USB-C debug fields.

## Web

- Added `DevicePowerPage` and `DevicePowerPanel`.
- Extended `device-runtime` and `deviceApi` for HTTP, Web Serial, and Local USB
  power config calls.
- Added host-lock heartbeat handling with per-panel owner IDs.
- Added a typed `/api/v1/pd-diagnostics` read path plus inline Dashboard
  USB-C card badges that render the shared firmware display contract directly:
  auto-follow keeps `PD` / `PPS` / `DC`, while manual output renders the
  manual setpoint `x.xxV` on the left badge and `FOCUS` / `ON` / `OFF` on the
  right badge, with the USB-C card header capped at exactly two badges while
  reusing the existing USB-C card V/A/W live telemetry.
- Refined the Dashboard USB-C status-chip gate so inline live badges suppress
  the legacy status chip only after the USB-C port telemetry resolves cleanly;
  legacy no-diagnostics states and real USB-C telemetry errors keep the
  existing status chip visible.
- Added protocol-card negotiation metadata so `PD`/`PPS` render `CC` and the
  current non-PD protocol set renders `DPDM`.
- Added card-level container-query behavior so negotiation badges show only on
  protocol cards that have enough local width to keep the layout readable.
- Added a constrained `MediumWideCards` Storybook regression state so the
  negotiation badges stay covered when the protocol grid becomes two columns
  without reverting to narrow-card hiding.
- Added Storybook coverage for default, auto-follow, host-locked, failure,
  save, restore, and narrow power-panel states, plus Dashboard USB-C inline
  live-badge states for `PD`, `FOCUS`, `ON`, and `OFF`.
- Added a config-only manual `Force` Storybook proof so visual evidence can
  directly show the settings page no longer renders the live USB-C state after
  that state moved into inline badges on Dashboard.
- Added Dashboard regression coverage for the legacy no-diagnostics fallback
  and for the case where live badges remain visible alongside a real USB-C
  telemetry error status chip.
- Fixed narrow responsive layout so the power cap and output mode controls do
  not clip.
- Added a `USB-C Idle Bias Calibration` section with dataset, correction, and
  run-state summaries, action gating, confirmation modals, and running-status
  messaging.
- Extended Storybook coverage with idle-bias uncalibrated, correction-on,
  running, confirmation, and failure states.

## Verification

- `cargo check --features net_http`
- `cd tools/isolapurr-host && cargo +stable-aarch64-apple-darwin test --no-run --target aarch64-apple-darwin --config 'build.target="aarch64-apple-darwin"'`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun run build-storybook`
- `cd web && bun run test:unit`
- `cd web && bun run test:storybook`
- `PORT=/dev/cu.usbmodem21221401 just flash`
- Local USB browser verification against `HIL-f293cc-USB`
- `cd web && bun test ./src`

Root `cargo test power_config` is not a valid gate for this repository target
as currently configured because the ESP `xtensa-esp32s3-none-elf` target lacks
the standard `test` crate. Migrated pure power-config and idle-bias logic now
runs through the shared firmware core host tests:
`cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$host"`.

`cd web && bun run test:storybook` was not run in this pass.

## HIL Verification

The HIL target is the IsolaPurr `tps-sw` SW2303 source-capability control
path. `power.config_*` must change the SW2303 advertised protocol set, power
cap, fixed PDO mask, and PPS availability; a sink must then observe matching
source capabilities and contracts. API readback alone is not sufficient.

Use `bash tools/hil-sw2303-matrix.sh ...` for repeatable manual runs. The script
forces LoadLynx CLI calls to run from `$HOME` so the IsolaPurr repo
`.esp32-port` selector does not pollute LoadLynx device discovery.
For modes that call `loadlynx pd set`, the saved LoadLynx hardware must be on
USB/devd transport; HTTP transport is rejected before any IsolaPurr config is
changed. The script acquires and heartbeats the IsolaPurr host lock, disables
the LoadLynx output on exit, restores the starting IsolaPurr power config by
default, and releases the HIL lock after restoration. When saving output with
`tee`, run through a shell with `pipefail` so script failures are not hidden.

Automated with LoadLynx:

- `--smoke`: defaults, fixed 12 V, PPS 11 V, restore fixed 12 V.
- `--pd`: full fixed/PPS matrix followed by capability-pruning cases.
- `--prune`: fixed PDO mask, PPS disabled, defaults restore, 22 V negative, and
  final fixed 12 V recovery.
- `--power --with-load --load-percent N`: power-cap load checks. This is gated
  behind explicit load enablement because it turns on the electronic load.

Manual external-sink coverage:

- LoadLynx validates PD fixed/PPS and load behavior only.
- QC2, QC3, FCP, AFC, SCP, PE2.0, SFCP, and BC1.2 require matching protocol
  sinks/triggers. These cases must not be claimed complete from LoadLynx-only
  evidence.

Required observation surfaces:

- LoadLynx `pd set` source caps and contract result.
- LoadLynx `status --json`: link, analog state, voltage, output state, fault
  flags.
- IsolaPurr `power.config_get`: persisted config.
- IsolaPurr `pd-diagnostics`: SW2303 request, TPS setpoint, profile applied,
  SW2303 read-back config, read-back match status, and SW2303/TPS latches.
- IsolaPurr `ports`: USB-C telemetry when available.

Capability matrix:

| Group | SW2303 config axis | Sink expectation |
| --- | --- | --- |
| Full profile | all protocols on, PD on, PPS on, fixed 9/12/15/20 V on, 100 W | LoadLynx sees fixed 5/9/12/15/20 V plus PPS 3.3-21 V; each requested contract matches diagnostics and telemetry. |
| Fixed PDO masks | none, 9 V only, 9+12 V, all fixed PDOs | LoadLynx source caps include only the enabled fixed PDOs; disabled PDO requests are rejected or fall back without remaining advertised. |
| PPS toggle | PPS on/off with fixed PDOs held constant | PPS APDO appears only when enabled; PPS requests inside disabled ranges are rejected and not advertised. |
| Power cap | 15, 27, 45, 60, 65, and 100 W | Source caps and load behavior must not exceed the configured cap. Load checks require `--with-load`. |
| Invalid config | 0 W, >100 W, unsupported hardware | API rejects without changing persisted config or SW2303 behavior. |
| Non-PD protocols | QC2/QC3/FCP/AFC/SCP/PE2/SFCP/BC1.2 single-protocol and all-non-PD profiles | Matching external sink triggers only the enabled protocol; PD sink must not be used as proof. |

Executed LoadLynx HIL results:

- `bash tools/hil-sw2303-matrix.sh --smoke --settle-sec 3`: passed
  `fixed 12 V`, `PPS 11 V`, and final `fixed 12 V`; load checks skipped.
- Full-profile PD/PPS coverage passed for fixed `5/9/12/15/20 V` and PPS
  `5.5/7/11/15/21 V`. All cases reported link up, LoadLynx fault flags `0`,
  `sw2303_error_latched=false`, and `tps_error_latched=false`.
- `bash tools/hil-sw2303-matrix.sh --prune --settle-sec 3`: failed capability
  pruning. `power.config_get` reported pruned configs such as `fixed=[]`,
  `pps=false`, or `fixed=[9000,12000]`, but LoadLynx still saw the full source
  capabilities including fixed 9/12/15/20 V and PPS APDO.
- Under pruned configs, positive requests for enabled 9 V / 12 V did not
  negotiate to the requested voltage; IsolaPurr diagnostics stayed at a 5 V
  SW2303 request while no fault latch was set.
- The 22 V PPS negative was rejected by LoadLynx with `LIMIT_VIOLATION`.
- Final recovery to full defaults and fixed 12 V passed; final state was full
  defaults, fixed 12 V, link up, LoadLynx fault flags `0`, and no SW2303/TPS
  fault latch.
- `bash tools/hil-sw2303-matrix.sh --power --with-load --load-percent 50
  --settle-sec 3`: passed with `pass=14 fail=0 skip=0` against IsolaPurr
  `856a14` and LoadLynx `loadlynx-d68638` over USB/devd. The run verified
  SW2303 read-back match, sink-visible source-cap current tiers, sink-side
  loaded voltage, link state, and fault latches for:
  - 15 W cap: 20 V fixed PDO limited to 750 mA; PPS windows limited to
    3.3-5.9 V at 3 A and 3.3-11 V at 1.65 A; 5 V / 500 mA load held at
    about 5.04 V on IsolaPurr telemetry and about 5.00 V on LoadLynx.
  - 27 W cap: 20 V fixed PDO limited to 1.35 A; PPS limited to 3.3-11 V at
    3 A; 9 V / 500 mA load held at about 9.03 V on IsolaPurr telemetry and
    about 8.97 V on LoadLynx.
  - 45 W cap: 20 V fixed PDO limited to 2.25 A; PPS limited to 3.3-16 V at
    3 A; 15 V / 500 mA load held at about 15.01 V on IsolaPurr telemetry and
    about 14.99 V on LoadLynx.
  - 60 W cap: 20 V fixed PDO limited to 3 A; PPS limited to 3.3-21 V at 3 A;
    20 V / 500 mA load held at about 20.00 V on IsolaPurr telemetry and
    about 20.01 V on LoadLynx.
  - 65 W cap: 20 V fixed PDO limited to 3.25 A; PPS limited to 3.3-21 V at
    3.25 A; 20 V / 500 mA load held at about 20.00 V on IsolaPurr telemetry
    and about 19.98 V on LoadLynx.
  - 100 W cap: 20 V fixed PDO limited to 5 A; PPS limited to 3.3-21 V at 5 A;
    20 V / 500 mA load held at about 20.00 V on IsolaPurr telemetry and
    about 19.95 V on LoadLynx.
  - Defaults recovery: full profile restored and final 12 V / 500 mA load held
    at about 12.02 V on IsolaPurr telemetry and about 11.99 V on LoadLynx.
  - `cd /Users/ivan && loadlynx ...` 65 W percentage sweep with 10 s holds on
    the 20 V fixed PDO:
    95% target (`3087 mA`) held around `19.6 V` / `i_total_ma=3074 mA` on
    LoadLynx; 100% target (`3250 mA`) held around `19.6 V` / `i_total_ma=3237
    mA`; 105% target (`3412 mA`) held around `18.3 V` / `i_total_ma=3396 mA`;
    110% target (`3575 mA`) dropped back to the safe `5 V` request path
    without setting a latch. The lower-level LoadLynx status view splits the
    current across `i_local_ma` and `i_remote_ma`, so `i_total_ma` is the
    correct sink-side current field for this sweep.

The earlier `--power --with-load --load-percent 50` load run stays within the
documented safe debug range of 500 mA. It proves source-cap advertisement,
SW2303 register read-back, and stable loaded output at that sink current. It
is not the 65 W over-limit sweep above.

Runtime remediation:

- `power.config_set` and `power.config_defaults` now clear stale SW2303 contract
  state and mark the profile for immediate runtime application when USB-C power
  is on and capability bits changed.
- SW2303 profile application now records structured register read-back for
  power cap, protocol bits, PPS enablement, and fixed PDO bits.
- `sw2303_profile_applied=true` now requires the read-back config to match the
  desired persisted config.
- When a runtime capability change reads back correctly, firmware briefly
  force-closes the SW2303 path and returns it to auto mode so an already
  attached sink must observe a fresh contract instead of cached source caps.
- `pd-diagnostics.sw2303_readback_config.matches_config` is the HIL gate for
  proving chip-register state; LoadLynx source caps remain the gate for proving
  sink-visible advertisement.
- Manual `default` path fallback now treats the Type-C 5 V source path as safe
  when there is no explicit negotiated protocol request, so passive 5.1 kΩ Rd
  sinks keep the SW2303 path `auto` and show live `ON` instead of regressing to
  `force_close`.

Idle-bias HIL still needs the empty-load bench sweep described in the feature
acceptance notes: USB-C disconnected, calibration run completed, and spot
checks at `3/5/9/12/15/20/21 V` comparing raw versus corrected current.
