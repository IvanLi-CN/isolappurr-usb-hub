# `tps-husb` Production Snapshot

This directory locks the owner-provided `PCB1_1` manufacturing snapshot. The
owner confirmed that this board has entered production. The directory date
identifies the source export set; it does not assert the factory production
date.

## Files

| File | SHA-256 | Role |
| --- | --- | --- |
| [`Netlist_Schematic1_1_2026-09-30.enet`](Netlist_Schematic1_1_2026-09-30.enet) | `4dbb26d6a1d2dcb6d5ce968be72b4398958bac0b4d9f2919fa8c7dfe0e94ff2a` | Exact schematic netlist supplied for this snapshot; byte-identical to [`hardware/tps-husb/netlist.enet`](../../netlist.enet) |
| [`Gerber_PCB1_1_2026-09-30.zip`](Gerber_PCB1_1_2026-09-30.zip) | `e9e4e1322c54ab7cffd15682913fb9d5eea49ee6b571135b722b1c080e95c8df` | Exact manufacturing export ZIP supplied for this snapshot |

The Gerber archive identifies a four-copper-layer board and includes copper,
solder mask, silkscreen, paste, board outline, drill, and flying-probe files.
It is a manufacturing export, not the editable PCB source.

## Preservation

Both files are preserved byte-for-byte as supplied. Do not regenerate or replace
them in this directory. Any later board revision must use a separate snapshot
directory and manifest so it cannot be confused with this production set.

## Review Record

A static inspection of the supplied Gerber found board-outline centerline
endpoint gaps of about 0.127 mm at the upper-right contour and 0.00518 mm on
the top contour. The top and bottom silkscreen data also extend beyond the
nominal board outline. These observations are recorded without changing the
production files; this archive is not a PCB-source DRC or electrical/thermal
qualification report.
