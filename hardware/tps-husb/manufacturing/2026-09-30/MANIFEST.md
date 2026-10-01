# `tps-husb` Hardware File Set

This directory stores the supplied `PCB1_1` netlist and Gerber manufacturing
exports. The directory date identifies the source export set.

## Files

| File | SHA-256 | Role |
| --- | --- | --- |
| [`Netlist_Schematic1_1_2026-09-30.enet`](Netlist_Schematic1_1_2026-09-30.enet) | `4dbb26d6a1d2dcb6d5ce968be72b4398958bac0b4d9f2919fa8c7dfe0e94ff2a` | Supplied schematic netlist; byte-identical to [`hardware/tps-husb/netlist.enet`](../../netlist.enet) |
| [`Gerber_PCB1_1_2026-09-30.zip`](Gerber_PCB1_1_2026-09-30.zip) | `e9e4e1322c54ab7cffd15682913fb9d5eea49ee6b571135b722b1c080e95c8df` | Supplied Gerber manufacturing export ZIP |

The Gerber ZIP contains four copper layers and includes copper,
solder mask, silkscreen, paste, board outline, drill, and flying-probe files.
It is a manufacturing export, not the editable PCB source.

## File Integrity and Revisions

Both files are saved byte-for-byte as supplied. Do not regenerate or replace
them in this directory. Any later hardware revision must use a separate
versioned directory and manifest.

## Review Record

A static inspection of the supplied Gerber found board-outline centerline
endpoint gaps of about 0.127 mm at the upper-right contour and 0.00518 mm on
the top contour. The top and bottom silkscreen data also extend beyond the
nominal board outline. These observations are recorded without changing the
supplied files. This ZIP does not provide editable PCB source, a PCB-source
DRC, or electrical/thermal qualification results.
