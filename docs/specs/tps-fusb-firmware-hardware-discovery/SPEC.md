# `tps-fusb` Firmware and Hardware Discovery

Status: 部分完成（2/6）

## Related ADRs

- [`0002-hardware-discovery-and-safe-mismatch-mode`](../../adr/0002-hardware-discovery-and-safe-mismatch-mode.md)

## Goal

Add a separately compiled `tps-fusb` firmware profile that uses the public
[`fusb302`](https://crates.io/crates/fusb302) crate for both FUSB302B PHYs,
while preserving `tps-sw` behavior. Every firmware image must determine the
installed board topology from read-only physical evidence before it initializes
profile-specific power or PD control. A wrong image must remain in a
diagnostic-only safe mismatch mode instead of driving the other board's power
path.

Web, `isolapurr`, and `isolapurr-devd` must select an artifact from the same
physical-discovery result. Normal running firmware is the preferred evidence
source; a RAM-only probe is the recovery fallback when normal communication is
not usable.

## Constraints

- Do not create, write, lock, look up, or depend on a board marker in eFuse,
  EEPROM, Flash, a label, or host-side storage.
- Keep `device_id` as the sole owner-facing device identity. Board topology is
  compatibility evidence, not device identity.
- Keep `tps-sw` and `tps-fusb` as separate compile-time profiles and separate
  release artifacts. A universal application image is not a goal.
- Do not scan I2C buses. The discovery implementation may address only the
  explicitly named devices below, and may make only non-mutating reads.
- A negative observation never identifies a board. Timeouts, NACKs, partial
  signatures, malformed data, and bus-recovery failures are `unknown`.
- Do not access SW2303 during discovery. It is powered from `VOUT_TPS`, which
  must remain disabled until the matching `tps-sw` profile is admitted.
- Product firmware must not write FUSB302B registers outside `fusb302` public
  APIs. Any missing typed FUSB API is added upstream and released before this
  repository uses it.
- Initial Source delivery must not claim PD 3.0 or PPS support. The FUSB302B
  documented PD revision boundary and Source HIL results govern later enablement.

## Hardware Coverage

This matrix covers all board differences visible to firmware or relevant to a
wrong-image safety boundary. The review is against every MCU-connected net,
each controller's bus/interrupt placement, and every pre-application power or
data-path default. The common GPIO, display, native USB, UART, and buzzer nets
were also compared; unchanged nets are deliberately not variant evidence.
Passive-value, layout, thermal, and BOM changes that do not reach an
MCU-controlled or MCU-observed interface remain hardware bring-up work, not
firmware compatibility evidence.

| Boundary | `tps-sw` | `tps-fusb` | Required design response |
| --- | --- | --- | --- |
| MCU memory and image | ESP32-S3R2 with in-package Quad PSRAM; existing boot-flash topology | ESP32-S3FH4R2 with 4 MB in-package Quad Flash and 2 MB Quad PSRAM | Separate artifacts, partitions, and build metadata. Validate early PSRAM/Flash initialization on both boards before relying on the mismatch path. |
| 3.3 V cold-start rail | U3 `EN` has the R4/R5 divider used by the existing board | U3 `EN` is not connected in the archived netlist to permit its cold-start behavior | This is a board-level condition before firmware runs. Scope both supplies and require each build to reach `BootSafety`; application code cannot repair a pre-execution rail failure. |
| Earliest controllable outputs | Current normal boot enables USB-A power/data and backlight | Normal boot keeps USB-A power, PMOS enhancement, TPS output, output VBUS gate, and LED inactive | Replace both normal-first sequences with one restrictive `BootSafety` sequence before any profile module. |
| USB-A and data routing | U7 has `IN=GND` and `P1_CED`; U8 has `IN=P1_ESP` and `P2_CED`. `P1_ESP` therefore selects the USB-C/ESP/TPS path when U8 is enabled. | U7 has `IN=P1_ESP` and `P1_CED`; U8 has `IN=GND` and `P2_CED`. `P1_ESP` therefore selects the USB-A route when U7 is enabled. | The common state sets GPIO2/4 High and GPIO5 Low, but a profile-specific `DataRouteController` exclusively owns all three pins after admission. There is no shared normal-routing table. |
| USB data-path reset/download defaults | `P1_CED`, `P2_CED`, and `P1_ESP` have external pull-downs; low enables each CH442E path. | The same control nets have external pull-downs, but their selected routes differ. | `BootSafety` disconnects the paths only after application execution starts. Scope reset, download mode, brownout, and crash restart; do not claim pre-application data isolation until HIL confirms it. |
| GPIO reassignment | GPIO1 is `BTNL`; GPIO33--36/38/47 are unused | GPIO1 is DC ADC; GPIO33 is `BTNL`; GPIO34/35 select input PMOS enhancement; GPIO36 gates USB-C VBUS; GPIO38 is `INT2`; GPIO47 is active-low open-drain LED | Keep GPIO1/33/38 high-impedance during discovery; GPIO34--36 Low; GPIO47 open-drain released. Profile code obtains exclusive ownership only after a match. |
| I2C1, GPIO8/9 | TPS55288, U13/U17 INA226, TMP112, EEPROM, CH224Q | U11 FUSB302B and U13 INA226 | Use a profile-neutral raw bus only for discovery. `tps-sw` and `tps-fusb` thereafter use distinct static allowlists and drivers. |
| I2C0, GPIO39/40 | SW2303 only, powered only after TPS output/POR | U10 FUSB302B, TPS55288, U17 INA226, EEPROM, TMP112 | Never issue the old SW2303 transaction before profile admission. `tps-fusb` owns the shared I2C0 bus through an interrupt-aware coordinator. |
| Interrupts | GPIO7 is shared system alert; GPIO38 unused | GPIO7 is U11/U13/U14 alert across both buses; GPIO38 is U10/U17/U23 alert | Use high-impedance inputs in discovery. `tps-fusb` services both candidate sets in task context; ISRs only set dirty flags. |
| PD architecture | CH224Q input protocol controller plus SW2303 output protocol controller | U10 Sink PHY and U11 Source PHY, with MCU protocol/policy | Do not reuse SW2303 policy/configuration as a FUSB policy. Build independent Sink and Source state machines. |
| Input source path | Existing topology, not MCU-controlled by GPIO34/35 | DC/USB single-PMOS paths, body-diode cold start, `VIN_EN`/`VIN_SEL` mutual exclusion | Only a single input selector owns GPIO34/35, always executes 5 ms break-before-make, and fails to Off. |
| TPS output and USB-C VBUS | TPS plus SW2303; no `TPS_USB_C_VBUS_EN` control | GPIO37 hard-disables TPS; GPIO36 controls PMOS from `VOUT_TPS` to `VBUS_TPS`; external VBUS can backfeed | Source policy must hold TPS and the PMOS off until safe attach and contract conditions. Any external VBUS/fault returns to gate off plus TPS disabled. |
| Operating envelope and analog input | TPS62933 UVLO divider is documented for 9--24 V; no MCU DC-input ADC | DC input is 9--28 V through GPIO1's 1:11 ADC; FUSB VBUS is at most 21 V; TPS `VOUT` is limited to 22 V recommended / 25 V absolute maximum | Keep input qualification, PD source capability, and fault thresholds in the profile policy. A 28 V DC rating never authorizes a 28 V USB-PD contract. |
| Telemetry and provisioning | U17, TMP112, EEPROM on I2C1 | U17, TMP112, EEPROM move to I2C0 | Give each profile a board map. EEPROM content is never used as compatibility evidence, and `tps-sw` power records never configure FUSB policy. |
| Human interfaces | GPIO1 left button; GPIO47 unused | GPIO33 left button; GPIO47 low-active LED | Mismatch mode uses USB diagnostics first. Display, Wi-Fi, LEDs, and buttons are optional read-only diagnostics, never prerequisites for recovery. |
| Audited common interfaces | GPIO0 right button, GPIO6 `LEDD`, GPIO7 `INT`, GPIO17 `P1_FAULT`, GPIO18 `UP0_PG`, display GPIO10--15, native USB GPIO19/20, buzzer GPIO21, and UART0 GPIO43/44 retain their board roles | Same roles and electrical directions, except the separately listed GPIO15 safe-start policy | Keep inputs high-impedance and optional peripherals uninitialized during discovery. A common net is not permission to reuse a profile-specific controller or routing policy. |
| Power-on/reset behavior | `P1_EN#` and `CE_TPS` have no explicit external bias in the parsed netlist | PMOS driver B1/B2 have required defaults; `CE_TPS` still needs electrical confirmation | Scope reset, download mode, brownout, and crash-restart states. Failure is a hardware acceptance blocker, not something firmware can paper over. |

## Common Safe Startup

The first executable application phase is `BootSafety`. It may initialize the
MCU and native USB console, but must not initialize Wi-Fi, display DMA, LEDC
tones, PD policy, telemetry sampling, EEPROM provisioning, or any
variant-specific controller.

| Resource | Common state | Reason |
| --- | --- | --- |
| GPIO37 `CE_TPS` | push-pull High | Hard-disables TPS55288 on both boards. |
| GPIO36 `TPS_USB_C_VBUS_EN` | Low | Closes the `tps-fusb` output PMOS; NC on `tps-sw`. |
| GPIO34 `VIN_EN` | Low | Disables both `tps-fusb` input PMOS active-enhancement paths; NC on `tps-sw`. |
| GPIO35 `VIN_SEL` | Low while `VIN_EN` is Low | Selects nothing actively and avoids a switching transition. |
| GPIO16 `P1_EN#` | High | Disables USB-A power on both boards. |
| GPIO2 / GPIO4 | High | Disables both CH442E data paths after application ownership. |
| GPIO5 `P1_ESP` | Low | Holds the selector at a harmless fixed level only while both CH442E paths are disabled; its normal route meaning differs by profile. |
| GPIO15 `BLK` | High | Turns the low-active backlight off. |
| GPIO21 buzzer | Low | Keeps the buzzer silent. |
| GPIO47 `LED_TPS` | open-drain released | Keeps the `tps-fusb` low-active LED group off; NC on `tps-sw`. |
| GPIO1, GPIO33, GPIO38, GPIO6, GPIO7, GPIO17, GPIO18 | high-impedance, no internal pulls unless a shared boot strap requires it | Avoids driving an ADC divider, button, alert, or isolated-side signal. |
| GPIO8/9/39/40 | open-drain I2C idle/released | Permits only the bounded discovery transactions. |

The implementation must program these outputs in safety-first order, verify
the pin configuration path with HIL waveforms, and only then make the
discovery reads. This table describes the first application-owned state, not
the reset or download-mode state. `esp_hal` initialization and PSRAM setup
occur before Rust can own GPIO; both profile builds must therefore be
independently verified to reach `BootSafety` on their matching board.

## Physical Discovery Contract

`HardwareDiscoveryV1` is a versioned result, not a string named `variant`.

```text
DiscoveryState = Verified | Unknown | Conflicting
Compatibility = Match | Mismatch | NotVerified
```

The required positive topology anchors are:

| Candidate profile | Required positive anchors | Explicit exclusions |
| --- | --- | --- |
| `tps-fusb` | U10 FUSB302B family ID at I2C0 `0x22` and U11 FUSB302B family ID at I2C1 `0x22`; both IDs must satisfy the documented `0x9x` family encoding and be stable across repeated reads | A single FUSB response, a reset/configure operation, or an inferred missing device is insufficient. |
| `tps-sw` | U17 INA226 at I2C1 `0x41`, with both read-only manufacturer ID and die ID equal to the production HIL baseline (`0x5449`, `0x2260`) across repeated reads | SW2303 is excluded because it is unpowered in `BootSafety`. CH224Q is excluded from the initial predicate because it has no immutable ID and can share the FUSB address. |

The U17 INA226 is powered from 3.3 V on both boards but is placed on different
buses. Its exact two-register signature at I2C1 is a positive, location-bound
`tps-sw` anchor. The detector may record CH224Q state as diagnostic evidence
after a later non-mutating contract exists, but it cannot promote a result from
`unknown` to `verified`.

Decision rules:

1. Complete FUSB vector only: `Verified(tps-fusb)`.
2. Complete INA U17/I2C1 vector only: `Verified(tps-sw)`.
3. Both complete: `Conflicting`.
4. Every other result: `Unknown`.

Every register selection/read is retried with bounded timeouts. The raw
observations, error kind, retry count, and evidence schema are retained in the
diagnostic response. No discovery result is persisted.

## Firmware Profile Contract

Each artifact exposes:

```json
{
  "compiledProfile": "tps-sw",
  "hardwareDiscovery": {
    "schema": 1,
    "state": "verified",
    "detectedProfile": "tps-sw",
    "evidence": []
  },
  "compatibility": "match",
  "hardwareCapabilities": {}
}
```

`compiledProfile`, `detectedProfile`, and `compatibility` are separate fields.
The old hard-coded `device.variant` field is removed from compatibility
decisions. A matching artifact may enter its normal runtime only after
`Verified` plus `Match`. An artifact with `Verified` plus `Mismatch` enters
safe mismatch mode; `Unknown` and `Conflicting` enter the same restrictive
mode with `NotVerified` compatibility.

Safe mismatch mode provides USB JSONL `info`, `diagnostics`, and a
machine-readable recovery hint. HTTP is allowed only after it can be started
without enabling a power path and must remain read-only. No power, port route,
configuration write, EEPROM write, PD, or FUSB/SW2303 initialization endpoint
is available in this mode.

## `tps-fusb` Firmware Design

### Profile boundary

The existing `tps-sw` main loop is split into:

- common boot safety, discovery, diagnostic transport, and profile admission;
- `tps_sw` implementation owning CH224Q/SW2303/TPS behavior;
- `tps_fusb` implementation owning both FUSB PHYs, input selection, TPS, VBUS
  gate, and its board map.

A profile-specific `DataRouteController` owns GPIO2, GPIO4, and GPIO5 only
after `Match`. Its `tps-sw` and `tps-fusb` route maps are separately tested
against the U7/U8 wiring above. It is not initialized in safe mismatch mode.

No shared `PowerConfig` type may claim to describe both protocol stacks. The
SW2303/QC/FCP/PPS persistence record remains `tps-sw`-specific. `tps-fusb`
gets a separately versioned policy/configuration schema after its supported
capabilities are validated.

### FUSB PHY boundary

`fusb302` owns FUSB302B I2C register operations. Before application work:

- extend its public API with a typed Type-C host-current selection;
- extend it with typed VBUS comparator/MDAC measurement and status access;
- test the extensions upstream with mocked I2C transactions and release a
  consumable version;
- add the released crate as the only FUSB register dependency here.

Project code uses `device_id()` only in discovery, then profile-owned typed
APIs for reset, CC, VCONN, FIFO, status, interrupts, and transmit/receive. It
does not emit raw FUSB register addresses or bit masks.

### Input and output ownership

- Input Sink policy owns U10 and publishes only a measured/negotiated input
  candidate. It does not write GPIO34/35.
- `InputPowerSelector` exclusively owns GPIO34/35. It evaluates DC ADC plus
  FUSB VBUS comparator/contract evidence, applies DC priority, and always
  performs the documented 5 ms break-before-make sequence.
- Output Source policy owns U11's Type-C/PD state. It requests a protected TPS
  setpoint and VBUS-gate transition from dedicated coordinators; it does not
  write GPIO36/37 directly.
- `TpsCoordinator` exclusively owns U14 and GPIO37. `VbusGateController`
  exclusively owns GPIO36. Any fault, detach, bad request, external VBUS,
  timeout, or invalid measurement transitions both to disabled.
- `InterruptCoordinator` owns GPIO7/38 and wakes task-context servicing for
  all devices on their mapped buses. It never changes a power GPIO in an ISR.

### Delivery stages

1. Build, discovery, safe mismatch, and no-power diagnostics on both profiles.
2. `tps-fusb` bus maps, FUSB PHY initialization, Type-C attach/detach, and
   read-only diagnostics with all VBUS paths disabled.
3. Input sink and input selector HIL: DC-only, USB-only, both inputs,
   brownout, contract loss, and failure-to-Off paths.
4. Output Source HIL: Type-C default-current 5 V, attach/detach, PD request,
   reset, over-current, TPS fault, external VBUS, and replug paths.
5. Additional Fixed PDOs, non-default Type-C current, PD 3.0, and PPS are
   individually enabled only after protocol, electrical, and interoperation
   evidence. They are not implied by a `PdRevision::Rev30` enum value.

## Host and Release Contract

Firmware catalog schema v2 adds an additive compatibility declaration to every
artifact:

```json
{
  "compatibleHardware": {
    "discoverySchema": 1,
    "profiles": ["tps-fusb"]
  }
}
```

It retains generic transport target names such as `esp32s3_app` and
`esp32s3_full`; the compatibility declaration is the separate board-selection
contract. Catalog v1 has no profile evidence and cannot be auto-selected for a
multi-profile flash flow.

All flash surfaces share this algorithm:

1. Use the owner-selected serial target; never enumerate and select a port.
2. Request running firmware `info`. Accept it only when its discovery schema,
   state, required evidence, and detected profile validate.
3. Select only an artifact whose compatibility declaration contains that
   detected profile. Also preserve the existing device ID/MAC confirmation.
4. If normal `info` is absent, legacy, malformed, unverified, or unavailable,
   run the RAM-only recovery probe on the selected target. A secure or disabled
   download path that cannot run the probe fails closed.
5. Flash exactly one matching artifact, reset/reopen the selected transport,
   and re-request `info`. Success requires a verified `Match` for the artifact
   just written.

`isolapurr-devd` owns the canonical Local USB probe/flash implementation;
`isolapurr` calls it over IPC. Web Local USB calls its devd bridge. Direct Web
Serial performs normal `info` discovery itself. Its RAM-probe fallback is
disabled until the browser `esptool-js` RAM-load path is validated against the
same `board-topology-probe` ELF; it must stop rather than guess. Any maintained
desktop direct-flash path uses the same compatibility contract or is blocked
from multi-profile flashing.

## Acceptance

- Given either matching board, when a profile image starts, then the common
  safe GPIO vector is observed before any profile I2C, PD, TPS, display, Wi-Fi,
  or EEPROM operation.
- Given `tps-fusb`, when both FUSB IDs are valid, then every profile reports
  `Verified(tps-fusb)`; no result follows from only one FUSB response.
- Given `tps-sw`, when the I2C1 U17 INA226 ID pair is valid, then every profile
  reports `Verified(tps-sw)` without accessing SW2303.
- Given a wrong image, unknown evidence, conflicting evidence, an I2C failure,
  or a failed RAM probe, when boot or preflight completes, then TPS, VBUS gate,
  input PMOS active enhancement, USB-A power, USB data paths, and
  profile-specific PD remain disabled and the diagnostic result is available
  through USB JSONL.
- Given either board in reset, download mode, brownout, or watchdog restart,
  when a GPIO has not yet entered `BootSafety`, then measured power and data
  path behavior meets the separately approved HIL waveform contract. Firmware
  does not claim that it controls this pre-application interval.
- Given a matching board after admission, when a data route is enabled, then
  the profile-specific U7/U8 map is used and no `tps-sw` route table is linked
  into a `tps-fusb` artifact or vice versa.
- Given a normal Web, CLI, or devd update, when an artifact is selected, then
  its catalog profile matches verified physical discovery before write and after
  reset.
- Given `tps-fusb` Source delivery, when no Source HIL has validated a feature,
  then that feature is not advertised or described as supported.

## References

- [`tps-fusb` hardware specification](../m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)
- [`tps-fusb` MCU resource allocation](../../mcu-resource-allocation-tps-fusb.md)
- [`tps-sw` MCU resource allocation](../../mcu-resource-allocation-tps-sw.md)
- [`tps-fusb` input selector](../../tps-fusb-input-power-path-selection.md)
- [`FUSB Source feasibility`](../../fusb302-source-mode-feasibility.md)
- [ESP32-S3 series comparison](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf)

## Visual Evidence

The owner-facing firmware flash surface was checked at the production SPA route
with the approved demo contract. The desktop capture uses the default browser
viewport; the mobile capture uses a 393 x 852 viewport. Both captures show the
connection, target, and discovery status surfaces without overlap or clipped
text.

- [Desktop firmware flash surface](assets/firmware-flash-desktop.png)
- [Mobile firmware flash surface](assets/firmware-flash-mobile.png)
