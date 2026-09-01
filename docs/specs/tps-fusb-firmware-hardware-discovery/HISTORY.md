# History

## Scope Decision

`tps-fusb` firmware, board-topology discovery, wrong-image containment, and
multi-profile flash selection are one compatibility problem. They are recorded
together because a correct FUSB driver still permits a harmful update if a host
can select the wrong artifact.

## Identity Decision

The board is identified from physical topology only. `device_id` remains the
owner-facing device identity; no persistent board marker, EEPROM field, eFuse
field, Flash value, label, or host mapping participates in compatibility.

## Evidence Decision

The detector uses positive location-bound signatures: dual FUSB IDs for
`tps-fusb`, and the I2C1 U17 INA226 manufacturer/die pair for `tps-sw`.
SW2303 cannot be an initial anchor because the safe state intentionally leaves
it unpowered. CH224Q is not an initial anchor because its read-only interface
does not provide an immutable ID and its address can overlap FUSB302B.

## Coverage Decision

The compatibility matrix is derived from every MCU-connected net, controller
placement, and startup default that can affect firmware behavior or a
wrong-image safety boundary. It records the U7/U8 CH442E `P1_ESP` route swap,
the 3.3 V cold-start difference, and the distinction between the
application-owned safe vector and reset/download electrical behavior. Passive,
layout, thermal, and BOM-only differences remain hardware bring-up work unless
they create a firmware-visible interface.

## Recovery Decision

Normal firmware `info` is the first compatibility source. RAM-only execution
is retained only for download-mode, blank, legacy, non-responsive, or
untrusted runtime cases, and it fails closed when download access is not
available.
