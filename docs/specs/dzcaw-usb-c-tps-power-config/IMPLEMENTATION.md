# Implementation

## Firmware

- Added `src/power_config.rs` with SW2303-only config types, validation,
  100 W current limiting, manual voltage/current quantization, and three-state
  USB-C path policy resolution.
- Extended the shared saved power config with `light_load_mode` using the
  existing EEPROM power record reserved byte, keeping record length/version
  compatibility and decoding missing legacy data as `pfm`.
- Added EEPROM load/store for a dedicated power-config record with fallback to
  full SW2303 auto-follow defaults.
- Extended API shared state with power config, lock, pending command, persisted
  state, and last SW2303 path control.
- Added HTTP and USB JSONL commands:
  - `power.config_get`
  - `power.config_set`
  - `power.config_defaults`
  - `power.lock`
- Extended the existing `power/config` request and response contract with a
  top-level `light_load_mode: "pfm" | "fpwm"` field instead of introducing a
  separate route or EEPROM record.
- Extended the persisted SW2303 capability model with explicit `current` and
  `fast_charge` subprofiles so saved source capability now covers the hidden
  current tiers and protocol-specific high-voltage toggles instead of relying
  on firmware hardcoded defaults.
- Updated the PD/TPS runtime loop so pending config writes are saved, applied,
  reflected in diagnostics, and used for SW2303 profile application.
- Added runtime-only power actions that map the owner-facing `Power`
  action to TPS55288 `OE` and the advanced output-off control to TPS55288
  `DISCHG`, while keeping both values out of the persisted EEPROM config.
- Added SW2303 path helpers for automatic control, force-close, and force-open.
- Added TPS55288 `MODE` register light-load helpers so saved
  `light_load_mode=fpwm` immediately forces PWM while preserving the board's
  external-VCC and `0x74` semantics, and saved `light_load_mode=pfm`
  immediately returns to strap-controlled behavior without disturbing `OE`,
  `DISCHG`, or unrelated bits.
- Added PD diagnostics readback for the applied TPS55288 `IOUT_LIMIT`
  register so HIL can compare requested current limit, quantized setpoint, and
  live register state without inferring the chain indirectly.
- Added live PD diagnostics `active_protocol` so Web and owner CLI can
  distinguish the currently negotiated protocol from the larger set of enabled
  advertised protocols.
- Increased the USB JSONL request frame buffer from `512` to `1024` bytes after
  HIL proved that the whole-config `power.config_set` payload now exceeds the
  old limit once capability, manual, and `light_load_mode` fields are all
  present in one Local USB write.
- Changed `power/config` rendering so `manual.path_policy` now prefers the live
  SW2303 path snapshot and otherwise falls back to the current saved config's
  derived policy, preventing transient `unknown` responses during immediate
  `power.config_set` / `power.config_defaults` replies.
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
- Added `isolapurr power config show|set` so the owner-facing CLI can read the
  whole saved power config, mutate only explicitly provided fields such as
  `light_load_mode` / `tps_mode` / manual output / source capabilities, and
  write the merged config back through the aligned `power.config_*` contract.
- Extended owner-facing CLI source-capability read/modify/write and TUI flows
  to preserve and expose the new `fast_charge` capability fields instead of
  silently dropping them on save.
- Added `isolapurr power idle-bias show|run|clear|set --enabled <bool>` with
  interactive confirmation and `--yes` bypass handling.
- Added `isolapurr power runtime output|discharge --enabled <bool>` so the
  owner CLI can control runtime-only TPS output gating without mutating the
  saved power profile, and added a manual high-voltage warning to the human
  `power show` output.
- Updated human CLI output so the main USB-C reading stays corrected while
  `--json` preserves both corrected telemetry and the raw USB-C debug fields.
- Updated the existing `power output ...` and `power source-capability set`
  flows to reuse the same read-modify-write config mutation helper, keeping the
  old entrypoints compatible while aligning them with the new `power config`
  surface.
- Normalized bare host `--url` values such as `192.168.31.224` into
  `http://...` API bases so power commands can target LAN devices without
  requiring an explicit scheme.
- Renamed owner-facing diagnostics output from ambiguous `ilim_ma` wording to
  explicit TPS `IOUT_LIMIT` terminology and exposed the raw register readback
  in both JSON and human-readable output.

## Web

- Added `DevicePowerPage` and `DevicePowerPanel`.
- Extended `device-runtime` and `deviceApi` for HTTP, Web Serial, and Local USB
  power config calls.
- Added runtime normalization so legacy responses that omit `light_load_mode`
  still render as `pfm` across HTTP, Web Serial, and Local USB paths.
- Split the Web power-config types into writable request fields and richer
  readback fields so `setPowerConfig()` strips read-only response data such as
  `manual.path_policy` before issuing `PUT /power/config`.
- Added host-lock heartbeat handling with per-panel owner IDs.
- Added a typed `/api/v1/pd-diagnostics` read path plus inline Dashboard
  USB-C card badges that render the shared firmware display contract directly:
  auto-follow keeps `PD` / `PPS` / `DC`, while manual output renders the
  manual setpoint `x.xxV` on the left badge and `FOCUS` / `ON` / `OFF` on the
  right badge. When live PD diagnostics also expose
  `tps_setpoint.iout_limit_ma`, the header prepends an `x.xx A` output-current
  limit badge while still reusing the existing USB-C card V/A/W live telemetry.
- Updated the Web diagnostics contract to consume
  `tps_setpoint.iout_limit_ma` plus `tps_iout_limit_readback`, matching the
  clarified TPS55288 `IOUT_LIMIT` semantics used by CLI and firmware.
- Refined the Dashboard USB-C status-chip gate so inline live badges suppress
  the legacy status chip only after the USB-C port telemetry resolves cleanly;
  legacy no-diagnostics states and real USB-C telemetry errors keep the
  existing status chip visible.
- Added protocol-card negotiation metadata so `PD`/`PPS` render `CC` and the
  current non-PD protocol set renders `DPDM`.
- Added card-level container-query behavior so negotiation badges show only on
  protocol cards that have enough local width to keep the layout readable.
- Reworked the protocol-card interaction so the whole card toggles
  enable/disable, removed the nested switch control, added inline compact
  selectors for persisted current and fast-charge options, and highlighted the
  live active protocol from PD diagnostics without overgrowing the panel.
- Moved the protocol option popovers to a body-level overlay so the inline
  selectors no longer lose pointer hit-testing when cards use clipped visual
  treatments, and raised narrow-screen hit areas to a touch-safe `44 px`
  minimum without re-expanding the desktop grid.
- Added a `TPS light-load mode` control to the existing Power settings panel so
  operators can switch between persisted `PFM` and `FPWM` without leaving the
  saved power-config surface.
- Reworked the Power page so the right-side actions column now carries the
  live USB-C voltage/current/power readout plus `Power` and `Replug` actions,
  while the manual-only advanced `TPS discharge on output-off` control remains
  separate and explicit about not solving SW2303 heating.
- Moved the `TPS light-load mode` explanatory copy into a help popover so the
  right rail stays compact without losing the board-default vs FPWM guidance.
- Hardened `DevicePowerPanel` late-load behavior so a successful reload or lock
  refresh no longer overwrites in-progress edits with a fresh `cloneConfig()`,
  while initial retry paths can still hydrate an empty form after a transient
  transport miss.
- Added a constrained `MediumWideCards` Storybook regression state so the
  negotiation badges stay covered when the protocol grid becomes two columns
  without reverting to narrow-card hiding.
- Added Storybook coverage for default, auto-follow, host-locked, failure,
  save, restore, and narrow power-panel states, plus Dashboard USB-C inline
  live-badge states for `PD`, `FOCUS`, `ON`, and `OFF`.
- Added a config-only manual `Force` Storybook proof so visual evidence can
  directly show the settings page no longer renders the live USB-C state after
  that state moved into inline badges on Dashboard.
- Aligned the power topic with the repository Web demo-surface policy so power
  verification now explicitly treats `/devices/:deviceId/power` as the real
  route-level page, reserves Storybook for composite `Panels/*` proofs, and
  forbids future dedicated power demo routes or page-level stories.
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

- `host=$(rustc +stable -vV | sed -n 's/^host: //p'); cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$host"`
- `cargo check --features net_http`
- `host=$(rustc +stable -vV | sed -n 's/^host: //p'); cargo +stable test --manifest-path tools/isolapurr-host/Cargo.toml --target "$host"`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun run build-storybook`
- `cd web && bun test ./src/domain/deviceApi.test.ts`
- `cd web && bunx playwright test e2e/light-load-hil.spec.ts --project=chromium`
- Storybook capture: `Panels/DevicePowerPanel/ForcedPwmMode`
- HIL on `tps-sw` device `856a141cdbd4` at `/dev/cu.usbmodem21221401`:
  `pfm -> set fpwm -> reboot -> still fpwm -> power defaults -> pfm ->
  settings reset other -> persisted=false,pfm`

Root `cargo test power_config` is not a valid gate for this repository target
as currently configured because the ESP `xtensa-esp32s3-none-elf` target lacks
the standard `test` crate. Migrated pure power-config and idle-bias logic now
runs through the shared firmware core host tests:
`cargo +stable test --manifest-path crates/isolapurr-firmware-core/Cargo.toml --target "$host"`.

The first HIL attempt exposed a Local USB transport bug rather than a TPS/EERPOM
bug: the saved whole-config `power.config_set` JSONL frame measured `622`
bytes, overflowed the firmware's `512`-byte USB JSONL line buffer, and was
dropped before `wait_power_config_result()` could ever complete. After raising
that buffer to `1024` bytes, the same board accepted the write and completed
the full persistence chain.

The later live-page regression was on the Web write model rather than EEPROM
or TPS state: the panel reused a response-shaped `manual` object and echoed the
read-only `path_policy` field back into `PUT /power/config`, which the bridge
correctly rejected. The request serializer now emits only writable power-config
fields, and the new Bun regression test locks that contract down.

The final live HIL pass used the built Web app plus `isolapurr-devd bridge-http`
against the same `856a141cdbd4` board. The Playwright regression seeds desktop
storage, opens `/devices/856a141cdbd4/power`, toggles `PFM -> FPWM -> PFM`
through the rendered panel, and polls the bridge `power/config` readback until
the persisted `light_load_mode` matches each saved state.

Later LAN HIL on `f293cc9c139e @ 192.168.31.224` used LoadLynx in `CV` mode as
the load stimulus and treated IsolaPurr PD diagnostics as the primary verdict
surface. At a `20 V / 3000 mA` manual target, both CLI/devd and Web/LAN control
paths held `tps_setpoint.iout_limit_ma=3000`,
`tps_iout_limit_readback.ma=3000`, and `usb_c_actual.current_ma≈3004` with no
TPS or SW2303 fault latches.

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
