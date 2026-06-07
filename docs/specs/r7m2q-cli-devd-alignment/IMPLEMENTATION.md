# Implementation

## Current coverage

- `isolapurr-devd` and `isolapurr` host-tools package added under `tools/isolapurr-host`.
- `isolapurr-devd serve` exposes a local IPC daemon by default: Unix domain socket on macOS/Linux and Windows named pipe on Windows. It tracks connected IPC clients and exits after the configured idle timeout when no clients remain.
- `isolapurr-devd bridge-http` exposes the device-centric localhost HTTP bridge, token bootstrap, Local USB scanning, leases, session traces, storage import/list/save, Wi-Fi/ports/status/route/diagnostics/power-config proxy methods, firmware catalog validation, and guarded flash/reset endpoints.
- `isolapurr` exposes released-style CLI entrypoints for hardware memory, discovery/devices/status, Wi-Fi, ports, flash, reset, monitor, and diagnostics over IPC, with sibling daemon auto-start when available.
- `isolapurr` now also exposes owner-facing power commands over the same IPC
  path: `power show`, `power defaults`, and `power source-capability set`.
- The CLI power flow reads the whole persisted config, mutates only the
  requested source-capability fields requested by the user, including protocol
  toggles, PD options, power cap, and current tiers, and writes the full config
  back through the aligned `power.config_*` transport contract.
- `power source-capability set` now has a terminal-only interactive mode when
  no update flags are supplied: it reads current config plus live status first,
  then renders a `ratatui`-based inline chip editor: one source-capability
  field per row, row-local choices on the same line, `Up/Down` field
  navigation, `Left/Right` inline choice changes, `Enter/Space` chip toggles,
  and an inline action row for reload and save/apply.
  When the owner does not supply `--hardware`, `--device`, or `--url`, the CLI
  first scans devd devices and prompts for a target with the same terminal
  selector instead of exiting with a selector error.
- Human-readable `power show` and `power defaults` output now translates the
  underlying chip-specific config/diagnostics payload into product-language
  summaries, while `--json` keeps the transport-shaped payload for automation.
- Local USB operations verify project firmware metadata from `info` before ordinary control paths. Non-project firmware, download-mode/no-JSONL targets, and incompatible firmware versions are rejected with corrective guidance; first-time full flash requires explicit confirmation.
- Web Local USB discovery/request/flash code now targets the new `/api/v1/devices/*` and lease APIs while leaving Web Serial intact. Device profiles can retain HTTP and Local USB transports for one hardware identity, and the runtime prefers successful Local USB operations for unsupported or unreachable Wi-Fi/HTTP paths.
- Repository skills added under `skills/isolapurr-user-operations` and `skills/isolapurr-developer-operations`.
- `isolapurr-user-operations` treats missing released host tools and unavailable installer assets as hard stop conditions before hardware enumeration or operations.
- CI/release workflows build and publish host-tools plus firmware catalog assets.
- CI runs Python contract tests for release-intent and skill/install-gate consistency.
- `host-tools.yml` builds/tests/packages host-tools archives for Linux, macOS, and Windows.
- Official host-tools installers added for Unix and Windows. Tag builds publish the host-tools archives, `SHA256SUMS`, and installer scripts to the matching GitHub Release.
- `firmware.yml` emits a firmware catalog artifact after firmware build.

## Remaining hardening

- Complete removal of the legacy Tauri-owned hardware-control server once the desktop packaging flow can bundle or locate `isolapurr-devd` at runtime.
- Expand firmware flashing from browser-selected files to release catalog selection in the Web UI.
- Expand mock and hardware-in-loop coverage as physical devices are available.
