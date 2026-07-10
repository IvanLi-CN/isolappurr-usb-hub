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
- MUST keep repo-managed user workflow docs and skills aligned to the current released CLI surface instead of restoring deprecated command aliases for documentation compatibility.
- MUST make `isolapurr-devd serve` expose only local IPC by default: Unix domain socket on macOS/Linux and named pipe on Windows.
- MUST keep `isolapurr` CLI communication with devd on local IPC. The CLI must not connect to devd through HTTP.
- MUST allow CLI and desktop clients to start `isolapurr-devd` on demand instead of requiring users to pre-start a daemon.
- MUST stop the IPC daemon after a bounded idle period when no clients remain connected, unless explicitly configured for a persistent development session.
- MUST expose localhost HTTP only through an explicit bridge command for browser/debug UI clients.
- MUST keep Web Serial available in the Web app as a formal supported channel.
- MUST probe a selected Web Serial target within a five-second operational
  deadline, excluding time spent in the browser-owned device picker. The probe
  MUST read IsolaPurr firmware identity before entering the lower-level
  hardware probe, MUST restore the firmware runtime after that probe, and MUST
  fail explicitly when the deadline expires. Expired or superseded work MUST
  not update the UI or reset the board later in the background.
- MUST have Web runtime arbitrate active channels across Web Serial, devd Local USB, and Wi-Fi/HTTP.
- MUST keep Agent-driven hardware operation on released CLI/devd unless the owner explicitly asks for browser Web Serial operation.
- MUST expose a standalone Web firmware flash workbench at `/flash`, with
  entry points from the Dashboard add-device area and the device Settings
  surface, while preserving the repository `?demo=true|false` contract instead
  of introducing ad hoc demo pages.
- MUST keep maintainer-facing workflow truth in one detailed project doc, with `README.md` as human navigation and `AGENTS.md` as concise entry rules rather than parallel full workflow manuals.
- MUST keep repo-managed Web verification guidance aligned with the repository
  Web demo-surface policy: production SPA routes stay as app-level pages,
  the formal owner-facing demo contract is `?demo=true|false` on those same
  routes, Storybook remains the mock-only component/composite surface, and
  page-level Storybook stories or extra ad hoc demo routes require an explicit
  spec-approved exception before landing.
- MUST treat missing `isolapurr` or `isolapurr-devd` on a user machine as an install gate before any Agent-driven hardware listing, scan, status, provisioning, flash, reset, monitor, or diagnostics workflow. The user skill must not list system USB or serial ports as a substitute hardware result.
- MUST report unavailable GitHub Release installer assets as a blocker for user-machine host-tool installation and stop instead of falling back to raw serial enumeration, localhost HTTP, browser automation, source checkout commands, or project-local tooling.
- MUST store local program hardware memory in the user's config directory, while pure Web stores the same profile shape in browser storage.
- MUST support importing/merging browser profiles into devd storage when devd is available.
- MUST make `isolapurr discover` perform real discovery instead of replaying
  saved bindings: LAN results come from mDNS/DNS-SD service discovery with
  `GET /api/v1/info` verification, Local USB results come from the current
  local hardware scan, and saved device profiles may only annotate matching
  results rather than replace discovery. When multiple saved records still
  match one live result, the CLI MUST surface only one canonical owner-facing
  saved record instead of listing duplicates for alternate transports.
- MUST verify Local USB targets are running IsolaPurr project firmware before ordinary device operations. The verification key is firmware metadata from `info`, including `firmware.name == "isolapurr-usb-hub"` and a compatible `firmware.version`.
- MUST reject ordinary status-adjacent control operations when the device is in download mode, does not answer project `info`, is running non-IsolaPurr firmware, or reports an incompatible firmware version. The error must explain whether the user should select the correct device, perform a first-time flash, or upgrade firmware.
- MUST validate firmware catalog target, flash address, file hash, and device identity before normal user flashing.
- MUST allow first-time full flash from the user CLI only after explicit port selection, target/artifact evidence, typed confirmation or explicit non-interactive confirmation, and post-flash identity capture.
- MUST require an explicit confirmation path before destructive operations that may affect download-mode or non-project firmware. CLI clients use an interactive typed confirmation or a confirmation flag for non-interactive runs; GUI clients must use a confirmation dialog.
- MUST build the Web release flash source from same-origin bundled firmware
  assets rather than runtime cross-origin GitHub downloads. The bundled
  manifest source is the current `IvanLi-CN/isolappurr-usb-hub` GitHub
  Releases list, filtered to non-draft releases and capped at the 50 most
  recent app-upgrade versions.
- MUST include `version/tag`, `publishedAt`, prerelease state, app-upgrade
  catalog metadata, and recovery availability in the bundled Web manifest so
  the `/flash` workbench can render a release list without querying GitHub at
  runtime.
- MUST bundle ordinary app-upgrade assets for the latest 50 release versions,
  but bundle recovery/full-flash assets only for the latest stable release and
  latest prerelease when one exists.
- MUST allow ordinary Web updates only when the probed target is confirmed as
  IsolaPurr firmware. The `/flash` workbench MUST also allow the owner to
  choose a bundled recovery image for a confirmed IsolaPurr target over normal
  hardware flashing, while recovery/provisioning for non-project,
  download-mode, or identity-unknown targets still requires a strong
  confirmation dialog.
- MUST keep bundled firmware binaries out of service-worker install-time
  precache; the Web UI may prefetch only the lightweight release manifest and
  must fetch firmware binaries on demand after the owner selects a version.
- MUST instruct users to upgrade firmware when `firmware.version` is below the devd-compatible minimum instead of attempting normal port/Wi-Fi/diagnostic operations.
- MUST expose owner-facing power-config inspection, semantic USB-C source
  capability commands, and manual output mode controls through `isolapurr`
  over IPC without falling back to raw register editing UX.
- MUST expose owner-facing saved power-config editing through
  `isolapurr power config show|set`, where `set` reads the current whole config,
  mutates only explicitly requested fields, and writes the full config back.
- MUST expose owner-facing device settings reset through `isolapurr settings
  reset wifi|other`. Human mode must require explicit confirmation unless a
  confirmation bypass flag is supplied; `--json` must return structured
  success/error output.
- MUST keep the reset safety boundary consistent across transports:
  `settings reset wifi` is allowed only through Web Serial or Local USB,
  while `settings reset other` may use any currently available device
  transport and must preserve Wi-Fi credentials.
- MUST treat the full 12-character `device_id` as the only owner-facing device selector for ordinary
  device control commands, including `status`, `wifi`, `ports`, `diagnostics`,
  and all `power` commands.
- MUST expose the current owner-facing status selector through the canonical device-id/url forms defined by the released CLI; repo-managed docs and skills MUST NOT present deprecated status selector variants as supported released forms.
- MUST expose the current owner-facing hardware save selector through the canonical device-id/name form defined by the released CLI; repo-managed docs and skills MUST NOT present deprecated hardware-save selector variants as supported released forms.
- MUST allow advanced Local USB maintenance flows to target hardware by
  `device_id`, `port_path`, or both together, with an explicit intersection
  check when both are supplied.
- MUST NOT expose saved hardware IDs or temporary devd target IDs as
  owner-facing selector classes.
- MUST redact PSKs, passwords, passphrases, secrets, and tokens in traces, diagnostics, and CLI output.
- SHOULD expose bounded session logs/traces for Local USB operations.
- SHOULD keep product docs and release workflows aligned with the shipped host-tools assets.
- SHOULD keep automated repo contract tests for repo-managed skill/doc drift when the released CLI boundary changes.

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
- `isolapurr power config show`
- `isolapurr power config set [--light-load-mode <pfm|fpwm>] [--tps-mode <auto_follow|manual>] [--voltage-mv <3000..21000>] [--current-limit-ma <1..6350>] [--usb-c-path <automatic|disconnected|forced-on>] [--power-watts <1..100>] [--pd <true|false>] [--pps <true|false>] [--qc20 <true|false>] [--qc30 <true|false>] [--fcp <true|false>] [--afc <true|false>] [--scp <true|false>] [--pe20 <true|false>] [--bc12 <true|false>] [--sfcp <true|false>] [--fixed-pd-voltages <9000,12000,15000,20000|none>] [--pps3-limit-ma <3000|5000>] [--pd-pps-5a <true|false>] [--type-c-broadcast-ma <500|1500>] [--scp-limit-ma <2000|4000|5000>] [--fcp-afc-sfcp-limit-ma <2250|3250>]`
- `isolapurr power defaults`
- `isolapurr power output manual [--voltage-mv <3000..21000>] [--current-limit-ma <1..6350>] [--usb-c-path <automatic|disconnected|forced-on>]`
- `isolapurr power output auto`
- `isolapurr power source-capability set [--power-watts <1..100>] [--pd <true|false>] [--pps <true|false>] [--qc20 <true|false>] [--qc30 <true|false>] [--fcp <true|false>] [--afc <true|false>] [--scp <true|false>] [--pe20 <true|false>] [--bc12 <true|false>] [--sfcp <true|false>] [--fixed-pd-voltages <9000,12000,15000,20000|none>] [--pps3-limit-ma <3000|5000>] [--pd-pps-5a <true|false>] [--type-c-broadcast-ma <500|1500>] [--scp-limit-ma <2000|4000|5000>] [--fcp-afc-sfcp-limit-ma <2250|3250>]`
- `isolapurr flash [--confirm-non-project-firmware]`, `isolapurr reset`, `isolapurr monitor`
- `isolapurr settings reset wifi|other [--yes]`
- `isolapurr diagnostics export`
- `install-isolapurr-host.sh [--version <tag>] [--install-dir <dir>] [--force] [--dry-run]`
- `install-isolapurr-host.ps1 [-Version <tag>] [-InstallDir <dir>] [-Force] [-DryRun]`

Selector scope for the released CLI is part of the public contract:

- `--device-id <device_id>` addresses the canonical owner-facing device identity
  and is the ordinary selector for control commands.
- `--port-path <port_path>` addresses an OS USB port and is reserved for
  advanced Local USB maintenance flows.
- `power` commands are ordinary owner-facing control and therefore must resolve
  by `device_id`, not by temporary USB scan IDs.

The IPC daemon protocol is newline-delimited JSON request/response. Requests include `{id, method, params}` and responses include `{id, ok, result|error}`. CLI-visible method families include:

- `devices.list`, `devices.scan`
- `device.status`, `device.session`, `device.wifi.get|set|clear`
- `device.ports.get`, `device.port.power`, `device.port.replug`, `device.hub.route_set`
- `device.power.config.get|set|defaults|lock|release`
- `device.settings.reset`
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
- `POST /api/v1/devices/{id}/settings/reset`
- `GET|PUT /api/v1/devices/{id}/power/config`
- `POST /api/v1/devices/{id}/power/config/defaults`
- `POST /api/v1/devices/{id}/power/config/lock`
- `POST /api/v1/devices/{id}/power/config/release`
- `POST /api/v1/devices/{id}/flash`
- `POST /api/v1/devices/{id}/flash-upload`
- `POST /api/v1/devices/{id}/flash-bundled`
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
- Given repo-managed user docs or skills are updated, when CI validates repository contracts, then stale released command fragments such as `status --hardware`, `status --device`, `hardware save --id`, and `hardware save --transport` must fail the contract gate.
- Given maintainer workflow truth changes, when project docs are updated, then `README.md`, `AGENTS.md`, and `docs/maintainer-workflow.md` must continue to link to the same workflow entrypoints instead of diverging into separate process narratives.
- Given repo-managed Web verification guidance changes, when repository
  contract tests run, then `README.md`, `web/README.md`, `AGENTS.md`,
  `docs/maintainer-workflow.md`, and the repo-contract workflow remain aligned
  to the same Web demo-surface policy and reject page-level stories plus ad hoc
  demo routes.
- Given an installer downloads a host-tools archive, when the archive hash does not match `SHA256SUMS`, then installation fails before replacing any installed tools.
- Given no IPC clients remain connected, when the configured idle timeout elapses, then `isolapurr-devd serve` exits and removes its Unix socket when applicable.
- Given the desktop app needs native Local USB capabilities, when no devd is reachable, then the desktop app starts or connects to devd on demand instead of requiring a user-managed daemon.
- Given `isolapurr-devd serve` is running, when localhost is scanned, then no HTTP devd API is exposed unless `isolapurr-devd bridge-http` was explicitly started.
- Given a browser supports Web Serial, when the user connects through the Web app, then Web Serial remains a normal channel and can be promoted by the runtime without devd.
- Given an authorized IsolaPurr Web Serial target is selected, when the owner
  starts or repeats device detection, then firmware and hardware identity are
  rendered within five seconds on repeated runs. If that deadline cannot be
  met, the page leaves the probing state with an actionable timeout and ignores
  any late completion from that probe generation.
- Given the same device is reachable through Web Serial and Wi-Fi/HTTP, when the runtime receives matching identity, then it updates one saved profile instead of creating a duplicate.
- Given the user runs `isolapurr discover`, when LAN devices advertise the
  IsolaPurr HTTP service and Local USB candidates are currently attached, then
  the CLI must return one combined discovery list where LAN entries come from
  mDNS + verified `info`, USB entries come from the current local scan, and at
  most one canonical saved device profile is shown as the owner-facing
  annotation on each live discovery result.
- Given a Local USB target does not answer IsolaPurr `info`, when the user requests status, Wi-Fi, ports, diagnostics, route, replug, or power operations, then devd refuses the operation and reports that the target may be in download mode or running non-IsolaPurr firmware.
- Given a Local USB target answers `info` with a different `firmware.name`, when any ordinary operation is requested, then devd refuses the operation and reports the expected firmware name.
- Given a Local USB target answers `info` with an incompatible `firmware.version`, when any ordinary operation is requested, then devd refuses the operation and asks the user to upgrade firmware.
- Given the user runs `isolapurr power source-capability set`, when one or more
  protocol, PD option, power-cap, or semantic current-tier flags are supplied,
  then the CLI reads the current whole power config, updates only the requested
  source-capability fields, writes the full config back over IPC, and reports
  the resulting config without exposing raw controller registers.
- Given the user runs `isolapurr power config set`, when one or more
  `light_load_mode`, `tps_mode`, manual output, or source-capability flags are
  supplied, then the CLI reads the current whole power config, updates only the
  requested fields, writes the full config back over IPC, and reports the
  resulting saved config.
- Given the user runs `isolapurr power source-capability set` without any
  update flags in a terminal, when the CLI starts, then it first reads the
  current hardware config plus live USB-C status and opens an interactive
  line-by-line editor where each row represents one source-capability field,
  shows that field's inline chips/options on the same line, and supports
  arrow-key field/choice navigation before save; if no selector was supplied,
  the CLI must first prompt for a saved device choice with the same friendly
  terminal selector instead of falling back to a temporary devd target.
- Given the user runs `isolapurr power output manual`, when manual output flags
  are supplied, then the CLI reads the current whole power config, switches the
  saved output mode to manual, updates only the requested manual output fields,
  preserves the existing source-capability fields, and reports the resulting
  saved config with owner-facing path labels instead of transport enums.
- Given the user runs a power command, when they try to pass a temporary devd
  target selector, then the CLI must reject that input at parse time and only
  accept canonical `device_id` selectors or the saved-device interactive picker.
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
- Given the user runs `isolapurr settings reset other --json`, when the selected
  device accepts the reset, then the CLI returns structured success with
  `scope=other` and `wifi_preserved=true`.
- Given the user runs `isolapurr settings reset wifi` from human mode without
  `--yes`, when stdin is interactive, then the CLI requires a typed
  confirmation before clearing Wi-Fi credentials.
- Given the selected transport is Wi-Fi / LAN, when the user runs
  `isolapurr settings reset wifi`, then the device-facing API rejects the
  request as `unsafe_transport` and no Wi-Fi credentials are erased.
- Given devd owns a Local USB session, when another devd client requests the same port during an exclusive flash/reset, then devd returns a busy error instead of opening the port concurrently.
- Given a firmware catalog references an app image, when CLI/devd flashes a normal update, then the image hash, target, address, and identity are verified before writing.
- Given first-time hardware lacks identity or is in download mode, when a user runs a full flash, then the CLI shows target/artifact evidence, requires a typed confirmation or explicit non-interactive confirmation flag, flashes the full artifact, and writes confirmed identity after reboot.
- Given the owner opens `/flash` in the Web app, when bundled firmware
  metadata is available, then the page renders the latest same-origin release
  list with version, published date, prerelease state, and recovery
  availability without fetching GitHub assets from the browser.
- Given the owner uses the Dashboard add-device area or a saved device
  Settings page, when they need provisioning, recovery, or manual firmware
  install, then each surface exposes an explicit entry point into the
  standalone firmware flash workbench.
- Given the Web release bundle is built for online hosting, when service
  worker install-time precache runs, then bundled firmware binaries are
  excluded from precache and are fetched only after the owner selects a
  release to flash.
- Given CLI Wi-Fi set includes a PSK, when session traces or diagnostics are exported, then the PSK is redacted.
- Given the desktop app starts, when devd is available, then desktop UI uses the devd API rather than a divergent hardware-control implementation.

## Visual Evidence

Dashboard entry:

![Dashboard flash entry](./assets/flash-dashboard-entry.png)

Add-device entry:

![Add device flash entry](./assets/flash-add-device-entry.png)

Settings entry:

![Settings flash entry](./assets/flash-settings-entry.png)

Standalone `/flash?demo=true` workbench, idle state with the restored
connection header rhythm and compact waiting placeholder:

![Firmware flash workbench idle demo](./assets/flash-workbench-demo-idle-refined.png)

Standalone `/flash?demo=true` workbench revalidated on the current page flow,
showing the default waiting target state and an empty flash log before any
transport is chosen:

![Firmware flash workbench idle waiting](./assets/flash-workbench-demo-idle-waiting.png)

Standalone `/flash?demo=true` workbench while `Web USB` is entering the
browser-picker stage, showing the centered prompt and waiting placeholder
before the page starts reading board identity, without an early countdown or
stale confirmed details:

![Firmware flash workbench Web USB picker](./assets/flash-workbench-demo-webusb-picker.png)

Standalone `/flash?demo=true&webUsb=authorized&probe=reading` workbench
showing the repeatable true `READING / PROBING` state while board identity is
being fetched. The compact target panel has a live loading rail, a serial-link
to firmware-identity progress cue, and a seconds-only right-side probe window.
The countdown is intentionally absent before a read starts:

![Firmware flash workbench Web USB reading](./assets/flash-workbench-demo-reading-info-v2.png)

Standalone `/flash?demo=true&webUsb=authorized&probe=timeout` workbench after
the five-second operational deadline. The active countdown is gone, the target
is explicitly unconfirmed, and the UI directs the owner to reconnect instead
of accepting a late probe result:

![Firmware flash workbench Web USB timeout](./assets/flash-workbench-demo-probe-timeout.png)

Standalone `/flash?demo=true` workbench after selecting a demo Local USB
target, showing the flattened target details without the redundant summary
strip or nested info cards:

![Firmware flash workbench connected demo](./assets/flash-workbench-demo-connected-refined.png)

Standalone `/flash?demo=true` workbench on a confirmed IsolaPurr target after
switching the right-rail mode toggle to `Recovery`, proving that ordinary
hardware is no longer blocked from bundled recovery flashing:

![Firmware flash workbench confirmed recovery demo](./assets/flash-workbench-demo-confirmed-recovery.png)

Standalone `/flash?demo=true` workbench during a mock bundled flash, proving
the progress panel, live flash log, and disabled primary action appear inside
the demo surface rather than only in implementation code:

![Firmware flash workbench flash progress demo](./assets/flash-workbench-demo-flash-progress.png)

Standalone `/flash?demo=true` right sidebar after layout refinement, proving
the primary flash action and return action now sit above `Flash log` instead of
below it:

![Firmware flash sidebar buttons above log](./assets/flash-sidebar-buttons-above-log.png)

Strong confirmation dialog for recovery on unconfirmed targets:

![Recovery strong confirmation](./assets/flash-strong-confirm.png)

Bundled release list Storybook surface:

![Bundled release list story](./assets/flash-release-list-story.png)

Real hardware `devd` / Local USB verification before flashing, with the page
showing the true hardware identity and the device still on `0.5.0`:

![Real hardware Local USB pre-flash](./assets/flash-devd-real-pre-v050.png)

Real hardware `devd` / Local USB flash completion on the same `/flash` page,
before the manual re-probe refresh:

![Real hardware Local USB post-write](./assets/flash-devd-real-post-write.png)

Real hardware `devd` / Local USB re-probe on the same page after flashing back
to the latest stable bundled release `0.5.1`:

![Real hardware Local USB post-reprobe](./assets/flash-devd-real-post-reprobe-v051.png)

Real hardware `Web Serial` recovery on the same `/flash` page, proving the
page can rewrite the board to the bundled recovery-capable stable release
`0.5.1` and refresh the rendered target values afterward:

![Real hardware Web Serial post-recovery](./assets/flash-web-serial-real-post-recovery-v051.png)

Real hardware `Web Serial` normal update on the same `/flash` page after the
recovery write, proving the page can return the board to bundled app image
`0.5.0` and keep the rendered hardware identity aligned:

![Real hardware Web Serial post-normal](./assets/flash-web-serial-real-post-normal-v050.png)
