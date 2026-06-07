# IsolaPurr CLI/devd alignment

## Background

IsolaPurr already has a Tauri desktop agent, Web Serial support, Wi-Fi/HTTP device APIs, and Local USB development commands. The next product boundary is to align local hardware operation with a released host-tools model: a local daemon owns native capabilities, a user CLI drives repeatable workflows, Web Serial remains a formal browser path, and the desktop app becomes a GUI client.

## Goals

- Ship `isolapurr-devd` as the local IPC daemon for discovery, Local USB, leases, firmware update, storage, and diagnostics.
- Ship `isolapurr` as the user-facing CLI for hardware memory, discovery, status, Wi-Fi provisioning, port control, flash, reset, monitor, and diagnostics.
- Keep `isolapurr-desktop` as a GUI client that starts or connects to `isolapurr-devd`; browser/Web access uses an explicit HTTP bridge rather than the default CLI transport.
- Preserve Web Serial as a first-class product path. It is not a debug-only fallback.
- Use one shared device profile schema across devd/CLI/desktop storage and browser storage.
- Introduce firmware catalog assets as the formal release update contract.
- Provide installable user and developer skills that preserve the user/developer boundary.

## Non-goals

- No long-term compatibility guarantee for the old desktop localhost API.
- No automatic serial-port selection.
- No browser-only replacement for native flashing when a native devd path is available.
- No cloud sync, account model, or fleet management.

## Requirements

- MUST publish two host-tools binaries: `isolapurr-devd` and `isolapurr`.
- MUST publish official user installers for released host tools. The installers MUST download platform-matching host-tools archives from GitHub Releases, verify them against `SHA256SUMS`, install only `isolapurr` and `isolapurr-devd` into a user-owned directory, and avoid modifying shell profiles or system PATH automatically.
- MUST make `isolapurr-devd serve` expose only local IPC by default: Unix domain socket on macOS/Linux and named pipe on Windows.
- MUST keep `isolapurr` CLI communication with devd on local IPC. The CLI must not connect to devd through HTTP.
- MUST allow CLI and desktop clients to start `isolapurr-devd` on demand instead of requiring users to pre-start a daemon.
- MUST stop the IPC daemon after a bounded idle period when no clients remain connected, unless explicitly configured for a persistent development session.
- MUST expose localhost HTTP only through an explicit bridge command for browser/debug UI clients.
- MUST keep Web Serial available in the Web app as a formal supported channel.
- MUST have Web runtime arbitrate active channels across Web Serial, devd Local USB, and Wi-Fi/HTTP.
- MUST keep Agent-driven hardware operation on released CLI/devd unless the owner explicitly asks for browser Web Serial operation.
- MUST treat missing `isolapurr` or `isolapurr-devd` on a user machine as an install gate before any Agent-driven hardware listing, scan, status, provisioning, flash, reset, monitor, or diagnostics workflow. The user skill must not list system USB or serial ports as a substitute hardware result.
- MUST report unavailable GitHub Release installer assets as a blocker for user-machine host-tool installation and stop instead of falling back to raw serial enumeration, localhost HTTP, browser automation, source checkout commands, or project-local tooling.
- MUST store local program hardware memory in the user's config directory, while pure Web stores the same profile shape in browser storage.
- MUST support importing/merging browser profiles into devd storage when devd is available.
- MUST verify Local USB targets are running IsolaPurr project firmware before ordinary device operations. The verification key is firmware metadata from `info`, including `firmware.name == "isolapurr-usb-hub"` and a compatible `firmware.version`.
- MUST reject ordinary status-adjacent control operations when the device is in download mode, does not answer project `info`, is running non-IsolaPurr firmware, or reports an incompatible firmware version. The error must explain whether the user should select the correct device, perform a first-time flash, or upgrade firmware.
- MUST validate firmware catalog target, flash address, file hash, and device identity before normal user flashing.
- MUST allow first-time full flash from the user CLI only after explicit port selection, target/artifact evidence, typed confirmation or explicit non-interactive confirmation, and post-flash identity capture.
- MUST require an explicit confirmation path before destructive operations that may affect download-mode or non-project firmware. CLI clients use an interactive typed confirmation or a confirmation flag for non-interactive runs; GUI clients must use a confirmation dialog.
- MUST instruct users to upgrade firmware when `firmware.version` is below the devd-compatible minimum instead of attempting normal port/Wi-Fi/diagnostic operations.
- MUST expose owner-facing power-config inspection, semantic USB-C source
  capability commands, and manual output mode controls through `isolapurr`
  over IPC without falling back to raw register editing UX.
- MUST treat saved hardware IDs and temporary devd targets as different
  selector classes with different usage scope.
- MUST treat `--hardware <saved-id>` as the owner-facing selector for ordinary
  device control commands, including `status`, `wifi`, `ports`, `diagnostics`,
  and all `power` commands.
- MUST treat `--device <temporary-devd-id>` as a temporary devd-target
  selector that is only valid for flows whose scope is inherently tied to a
  transient Local USB target, such as pre-bind identification, flashing, and
  reset/maintenance actions.
- MUST NOT accept temporary devd-target selectors for owner-facing `power`
  commands. `power` commands may only use saved hardware IDs or a selector
  flow that resolves to a saved hardware record.
- MUST redact PSKs, passwords, passphrases, secrets, and tokens in traces, diagnostics, and CLI output.
- SHOULD expose bounded session logs/traces for Local USB operations.
- SHOULD keep product docs and release workflows aligned with the shipped host-tools assets.

## Public Interfaces

- `isolapurr-devd serve [--endpoint <ipc-endpoint>] [--idle-timeout-secs <seconds>]`
- `isolapurr-devd bridge-http --bind 127.0.0.1:<port> [--web-root <path>] [--allow-dev-cors]`
- `isolapurr [--ipc <ipc-endpoint>] [--no-auto-start] ...`
- `isolapurr hardware available|recent|list|save|forget|path`
- `isolapurr devices`, `isolapurr discover`, `isolapurr status`
- `isolapurr wifi show|set|clear`
- `isolapurr ports`
- `isolapurr ports power --port <port_id> --enabled <true|false>`
- `isolapurr ports replug --port <port_id>`
- `isolapurr ports route --route <mcu|usb_c>`
- `isolapurr power show`
- `isolapurr power defaults`
- `isolapurr power output manual [--voltage-mv <3000..21000>] [--current-limit-ma <1..6350>] [--usb-c-path <automatic|disconnected|forced-on>]`
- `isolapurr power output auto`
- `isolapurr power source-capability set [--power-watts <1..100>] [--pd <true|false>] [--pps <true|false>] [--qc20 <true|false>] [--qc30 <true|false>] [--fcp <true|false>] [--afc <true|false>] [--scp <true|false>] [--pe20 <true|false>] [--bc12 <true|false>] [--sfcp <true|false>] [--fixed-pd-voltages <9000,12000,15000,20000|none>] [--pps3-limit-ma <3000|5000>] [--pd-pps-5a <true|false>] [--type-c-broadcast-ma <500|1500>] [--scp-limit-ma <2000|4000|5000>] [--fcp-afc-sfcp-limit-ma <2250|3250>]`
- `isolapurr flash [--confirm-non-project-firmware]`, `isolapurr reset`, `isolapurr monitor`
- `isolapurr diagnostics export`
- `install-isolapurr-host.sh [--version <tag>] [--install-dir <dir>] [--force] [--dry-run]`
- `install-isolapurr-host.ps1 [-Version <tag>] [-InstallDir <dir>] [-Force] [-DryRun]`

Selector scope for the released CLI is part of the public contract:

- `--hardware <saved-id>` addresses a saved hardware record and is the
  owner-facing selector for ordinary control commands.
- `--device <temporary-devd-id>` addresses a transient devd scan result and is
  reserved for temporary-target Local USB maintenance flows.
- `power` commands are in the first category only: they must use
  `--hardware <saved-id>` or a saved-hardware picker, and they must not expose
  `--device <temporary-devd-id>` as a supported selector.

The IPC daemon protocol is newline-delimited JSON request/response. Requests include `{id, method, params}` and responses include `{id, ok, result|error}`. CLI-visible method families include:

- `devices.list`, `devices.scan`
- `device.status`, `device.session`, `device.wifi.get|set|clear`
- `device.ports.get`, `device.port.power`, `device.port.replug`, `device.hub.route_set`
- `device.power.config.get|set|defaults|lock|release`
- `serial.lease.create`, `serial.lease.release`
- `device.flash`, `device.reset`, `device.diagnostics`
- `firmware.catalog.validate`

The explicit HTTP bridge API remains device-centric for browser/debug clients:

- `GET /api/v1/bootstrap`
- `GET /api/v1/health`
- `GET /api/v1/devices`
- `POST /api/v1/devices/scan`
- `GET /api/v1/devices/{id}/status`
- `GET /api/v1/devices/{id}/session`
- `POST /api/v1/serial/lease`
- `POST|DELETE /api/v1/serial/lease/{lease_id}`
- `GET|POST|DELETE /api/v1/devices/{id}/wifi`
- `GET /api/v1/devices/{id}/ports`
- `POST /api/v1/devices/{id}/ports/{port_id}/power`
- `POST /api/v1/devices/{id}/ports/{port_id}/replug`
- `POST /api/v1/devices/{id}/hub/route`
- `GET|PUT /api/v1/devices/{id}/power/config`
- `POST /api/v1/devices/{id}/power/config/defaults`
- `POST /api/v1/devices/{id}/power/config/lock`
- `POST /api/v1/devices/{id}/power/config/release`
- `POST /api/v1/devices/{id}/flash`
- `POST /api/v1/devices/{id}/flash-upload`
- `POST /api/v1/devices/{id}/reset`
- `GET /api/v1/devices/{id}/diagnostics`
- `GET|POST /api/v1/storage/devices`
- `DELETE /api/v1/storage/devices/{id}`
- `GET|PUT /api/v1/storage/settings`
- `POST /api/v1/storage/migrate/localstorage`
- `GET /api/v1/storage/export`
- `POST /api/v1/storage/reset`
- `POST /api/v1/storage/import`
- `GET /api/v1/firmware/catalog/validate`

## Acceptance Criteria

- Given released host tools are installed, when a user runs `isolapurr devices`, then the CLI connects to local IPC or auto-starts a sibling `isolapurr-devd serve` without requiring a source checkout or localhost HTTP server.
- Given a normal user machine does not have released host tools installed, when the user skill prepares hardware operation, then it must present the release source, version, install directory, and PATH impact, ask for confirmation, run the official installer, and verify `isolapurr --help` plus `isolapurr-devd --help`.
- Given released host tools are missing, when the user asks the skill to list available hardware, then the skill stops at the install gate and does not enumerate system USB or serial ports as a substitute result.
- Given the selected GitHub Release or installer asset is unavailable, when the user skill prepares host-tool installation, then it reports the release/asset blocker and stops without switching to source commands, raw serial tools, browser automation, or localhost HTTP.
- Given an installer downloads a host-tools archive, when the archive hash does not match `SHA256SUMS`, then installation fails before replacing any installed tools.
- Given no IPC clients remain connected, when the configured idle timeout elapses, then `isolapurr-devd serve` exits and removes its Unix socket when applicable.
- Given the desktop app needs native Local USB capabilities, when no devd is reachable, then the desktop app starts or connects to devd on demand instead of requiring a user-managed daemon.
- Given `isolapurr-devd serve` is running, when localhost is scanned, then no HTTP devd API is exposed unless `isolapurr-devd bridge-http` was explicitly started.
- Given a browser supports Web Serial, when the user connects through the Web app, then Web Serial remains a normal channel and can be promoted by the runtime without devd.
- Given the same device is reachable through Web Serial and Wi-Fi/HTTP, when the runtime receives matching identity, then it updates one saved profile instead of creating a duplicate.
- Given a Local USB target does not answer IsolaPurr `info`, when the user requests status, Wi-Fi, ports, diagnostics, route, replug, or power operations, then devd refuses the operation and reports that the target may be in download mode or running non-IsolaPurr firmware.
- Given a Local USB target answers `info` with a different `firmware.name`, when any ordinary operation is requested, then devd refuses the operation and reports the expected firmware name.
- Given a Local USB target answers `info` with an incompatible `firmware.version`, when any ordinary operation is requested, then devd refuses the operation and asks the user to upgrade firmware.
- Given the user runs `isolapurr power source-capability set`, when one or more
  protocol, PD option, power-cap, or semantic current-tier flags are supplied,
  then the CLI reads the current whole power config, updates only the requested
  source-capability fields, writes the full config back over IPC, and reports
  the resulting config without exposing raw controller registers.
- Given the user runs `isolapurr power source-capability set` without any
  update flags in a terminal, when the CLI starts, then it first reads the
  current hardware config plus live USB-C status and opens an interactive
  line-by-line editor where each row represents one source-capability field,
  shows that field's inline chips/options on the same line, and supports
  arrow-key field/choice navigation before save; if no selector was supplied,
  the CLI must first prompt for a saved hardware choice with the same friendly
  terminal selector instead of falling back to a temporary devd target.
- Given the user runs `isolapurr power output manual`, when manual output flags
  are supplied, then the CLI reads the current whole power config, switches the
  saved output mode to manual, updates only the requested manual output fields,
  preserves the existing source-capability fields, and reports the resulting
  saved config with owner-facing path labels instead of transport enums.
- Given the user runs a power command, when they try to pass a temporary devd
  target selector, then the CLI must reject that input at parse time and only
  accept saved hardware IDs or the saved-hardware interactive picker.
- Given the user runs `isolapurr power output auto`, when the saved config is
  written successfully, then the CLI returns the output mode to automatic
  USB-C request tracking without discarding the saved manual voltage/current
  target.
- Given the user runs `isolapurr power show` without `--json`, when the CLI
  renders the result, then it summarizes saved power settings and live USB-C
  source state without requiring chip-specific field names.
- Given `isolapurr power defaults` times out after the device accepts the
  request, when the CLI re-reads the saved config and finds the expected
  default profile, then it must treat the operation as success instead of
  surfacing a false failure.
- Given devd owns a Local USB session, when another devd client requests the same port during an exclusive flash/reset, then devd returns a busy error instead of opening the port concurrently.
- Given a firmware catalog references an app image, when CLI/devd flashes a normal update, then the image hash, target, address, and identity are verified before writing.
- Given first-time hardware lacks identity or is in download mode, when a user runs a full flash, then the CLI shows target/artifact evidence, requires a typed confirmation or explicit non-interactive confirmation flag, flashes the full artifact, and writes confirmed identity after reboot.
- Given CLI Wi-Fi set includes a PSK, when session traces or diagnostics are exported, then the PSK is redacted.
- Given the desktop app starts, when devd is available, then desktop UI uses the devd API rather than a divergent hardware-control implementation.

## Visual Evidence

Visual evidence for UI changes belongs to `docs/specs/u5b2c-usb-console-provisioning/SPEC.md` unless a future UI change is specific only to this daemon/CLI boundary.
