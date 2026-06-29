# SW2303 And TPS Cable Compensation Mapping

## Context

The `tps-sw` board uses two different compensation concepts:

- TPS55288 cable droop compensation on register `0x05 CDC`
- SW2303 line compensation spread across `0x14`, `0xA4`, and `0xAD bit7`

This looked redundant during UI planning because SW2303 exposes three control
points for one owner-facing line-compensation choice.

## Decision

Expose only two owner-facing settings:

- Manual-output `cable compensation` for TPS55288
- Auto-follow `line compensation` for SW2303

Do not expose raw register fields.

## Why SW2303 Needs Three Registers

- `0x14 bit2` is the coarse runtime open/close switch for line compensation.
- `0xA4 bits7:6` select the impedance bucket: `50mΩ`, `0`, `100mΩ`, or
  `150mΩ`.
- `0xAD bit7` extends that compensation behavior into the
  `QC2/QC3/PD FIX` protocol family.

Those registers are not duplicates. They combine:

- a master enable
- an impedance level
- a protocol-scope gate

Firmware should treat them as one semantic setting and expand the write
sequence internally.

## TPS55288 Constraint

TPS55288 supports:

- internal cable compensation via `CDC_OPTION=0`
- external resistor-based compensation via `CDC_OPTION=1`

The current `tps-sw` assembly leaves `R36` unpopulated (`n.c.`), so the board
does not provide a valid external resistor path on the TPS `CDC` pin.

Because of that:

- owner-facing UI/CLI/API must not expose `external CDC`
- firmware must always force `CDC_OPTION=internal`
- firmware must only change `CDC[2:0]`
- firmware must preserve the rest of register `0x05` with RMW

## Runtime Rule

- `auto_follow`: apply the saved SW2303 line compensation, force TPS CDC to
  `0V rise`
- `manual`: apply the saved TPS CDC rise, force SW2303 line compensation off

This avoids double compensation while preserving both saved preferences.
