# Hardware Discovery and Safe Mismatch Mode

IsolaPurr keeps `device_id` as its sole owner-facing device identity. It does not use any persistent per-board marker, including eFuse, EEPROM, Flash, labels, or host-side mappings, to distinguish hardware variants. Firmware artifacts remain separately compiled for `tps-sw` and `tps-fusb`; compatibility is determined only by an ephemeral, versioned, read-only hardware-discovery result obtained while all controllable power paths are inactive.

Every artifact must first establish a hardware-neutral safe state, run the common discovery gate, and enter safe mismatch mode when its compiled hardware variant does not match the verified board topology. Hardware-neutral means a deliberately restrictive state, not either profile's normal boot state: TPS disabled, the USB-C output gate disabled, input PMOS active enhancement disabled, USB-A power disabled, data paths disconnected, backlight disabled, buzzer silent, and profile-only GPIOs inactive. The gate uses only allowlisted, non-mutating physical-topology evidence; an I2C acknowledgement alone is insufficient. In safe mismatch mode the artifact must not initialize variant-specific power control or enable a controllable power path, but it must expose the detected profile, compiled variant, compatibility state, and recovery guidance through the available diagnostic transport.

That state begins only after the application owns the GPIOs. In particular,
the CH442E enable nets have external pull-downs and the two board revisions
wire `P1_ESP` to different switch paths. Reset, download mode, brownout, and
crash-restart behavior are separate electrical acceptance gates; firmware does
not claim that application code isolates data paths before it starts.

For a normally communicating device, Web, CLI, and devd must obtain that common discovery result through the running firmware's versioned `info` response before deciding an artifact. The response is valid only when it includes the discovery schema, a `verified` result, and the detected profile; a legacy or hard-coded compiled-variant field is not physical-topology evidence. The RAM recovery probe is used only when that normal report is unavailable, unsupported, malformed, or fails verification.

## Considered Options

- Infer the board variant from ESP32-S3 model, USB identity, Flash size, or PSRAM. These signals are not a verified board-compatibility contract.
- Use only a firmware-reported variant. It cannot select a first-flash artifact and can be false after a wrong flash.
- Store, lock, or look up hardware identity in eFuse, EEPROM, Flash, a printed label, or a host-side mapping. Hardware distinction must come from the board's physical topology alone.

## Consequences

- The common discovery gate must use only read-only topology evidence and produce `verified`, `unknown`, or `conflicting` results.
- The initial evidence vector is deliberately asymmetric because the hardware is asymmetric:
  - `tps-fusb` requires two positive FUSB302B family device-ID reads: U10 at I2C0 `0x22` and U11 at I2C1 `0x22`.
  - `tps-sw` requires the read-only INA226 manufacturer-ID and die-ID pair at I2C1 `0x41`, the U17 placement unique to that topology. The expected production values are validated on hardware before release.
  - Matching both vectors is `conflicting`; matching neither or only part of a vector is `unknown`.
- The initial gate does not read SW2303: it is powered by `VOUT_TPS`, which remains disabled in the safe state. It also does not classify CH224Q from an acknowledgement because CH224Q has no immutable device-ID and its address can overlap the FUSB302B address. CH224Q may appear as diagnostic-only supporting evidence only after a separate read-only signature is hardware-validated.
- The detector performs no I2C scan, no controller reset, no FUSB PHY configuration, no Type-C pull configuration, no EEPROM access, and no power-path write. It uses only the named addresses and read-only register accesses defined by the evidence vector.
- Firmware catalogs, Web, CLI, and devd must prefer a running firmware's verified normal discovery report, match a normal artifact to it before flashing, and revalidate it through normal communication after flashing.
- Only download-mode, blank-device, legacy, non-responsive, or otherwise unverified flows may use the RAM recovery probe before a variant-specific artifact is selected.
- Unknown, malformed, or conflicting discovery results are fail-closed for normal flashing; recovery remains an explicitly authorized maintenance flow.
- Firmware can establish the neutral state only after the MCU starts executing. The reset/download-mode electrical state of `P1_EN#`, `CE_TPS`, and every FUSB power-control net is a separate hardware acceptance gate, verified with physical measurements. Firmware must not claim reset-safe behavior until that gate passes.
- The U7/U8 CH442E routing map is profile-specific: the `tps-sw` U8 input is
  `P1_ESP`, while the `tps-fusb` U7 input is `P1_ESP`. A common disabled vector
  is valid, but a common normal-routing table is forbidden. The reset/download
  acceptance gate also includes both data-switch enable nets.
