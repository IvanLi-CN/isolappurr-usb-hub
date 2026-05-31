# Implementation

## Current coverage

- `isolapurr-devd` and `isolapurr` host-tools package added under `tools/isolapurr-host`.
- `isolapurr-devd serve` exposes a local IPC daemon by default: Unix domain socket on macOS/Linux and Windows named pipe on Windows.
- `isolapurr-devd bridge-http` exposes the device-centric localhost HTTP bridge, token bootstrap, Local USB scanning, leases, session traces, storage import/list/save, Wi-Fi/ports/status/route/diagnostics proxy methods, firmware catalog validation, and guarded flash/reset endpoints.
- `isolapurr` exposes released-style CLI entrypoints for hardware memory, discovery/devices/status, Wi-Fi, ports, flash, reset, monitor, and diagnostics over IPC, with sibling daemon auto-start when available.
- Web Local USB discovery/request/flash code now targets the new `/api/v1/devices/*` and lease APIs while leaving Web Serial intact.
- Repository skills added under `skills/isolapurr-user-operations` and `skills/isolapurr-developer-operations`.
- CI/release workflows build and publish host-tools plus firmware catalog assets.
- `host-tools.yml` builds/tests/packages host-tools archives for Linux, macOS, and Windows.
- `firmware.yml` emits a firmware catalog artifact after firmware build.

## Remaining hardening

- Complete removal of the legacy Tauri-owned hardware-control server once the desktop packaging flow can bundle or locate `isolapurr-devd` at runtime.
- Expand firmware flashing from browser-selected files to release catalog selection in the Web UI.
- Expand mock and hardware-in-loop coverage as physical devices are available.
