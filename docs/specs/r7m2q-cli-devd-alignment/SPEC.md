# IsolaPurr CLI/devd alignment

## Background

IsolaPurr already has a Tauri desktop agent, Web Serial support, Wi-Fi/HTTP device APIs, and Local USB development commands. The next product boundary is to align local hardware operation with a released host-tools model: a local daemon owns native capabilities, a user CLI drives repeatable workflows, Web Serial remains a formal browser path, and the desktop app becomes a GUI client.

## Goals

- Ship `isolapurr-devd` as the localhost daemon for discovery, Local USB, leases, firmware update, storage, and diagnostics.
- Ship `isolapurr` as the user-facing CLI for hardware memory, discovery, status, Wi-Fi provisioning, port control, flash, reset, monitor, and diagnostics.
- Keep `isolapurr-desktop` as a GUI client that starts or connects to `isolapurr-devd` and consumes the same localhost API as Web.
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
- MUST keep Web Serial available in the Web app as a formal supported channel.
- MUST have Web runtime arbitrate active channels across Web Serial, devd Local USB, and Wi-Fi/HTTP.
- MUST keep Agent-driven hardware operation on released CLI/devd unless the owner explicitly asks for browser Web Serial operation.
- MUST store local program hardware memory in the user's config directory, while pure Web stores the same profile shape in browser storage.
- MUST support importing/merging browser profiles into devd storage when devd is available.
- MUST validate firmware catalog target, flash address, file hash, and device identity before normal user flashing.
- MUST allow first-time full flash from the user CLI only after explicit port selection, target/artifact evidence, typed confirmation, and post-flash identity capture.
- MUST redact PSKs, passwords, passphrases, secrets, and tokens in traces, diagnostics, and CLI output.
- SHOULD expose bounded session logs/traces for Local USB operations.
- SHOULD keep product docs and release workflows aligned with the shipped host-tools assets.

## Public Interfaces

- `isolapurr-devd serve --bind 127.0.0.1:<port> [--web-root <path>] [--allow-dev-cors]`
- `isolapurr hardware available|recent|list|save|forget|path`
- `isolapurr devices`, `isolapurr discover`, `isolapurr status`
- `isolapurr wifi show|set|clear`
- `isolapurr ports`
- `isolapurr ports power --port <port_id> --enabled <true|false>`
- `isolapurr ports replug --port <port_id>`
- `isolapurr ports route --route <mcu|usb_c>`
- `isolapurr flash`, `isolapurr reset`, `isolapurr monitor`
- `isolapurr diagnostics export`

The daemon API is device-centric:

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

- Given released host tools are installed, when a user starts `isolapurr-devd serve`, then `isolapurr devices` can discover devd-visible hardware without requiring a source checkout.
- Given a browser supports Web Serial, when the user connects through the Web app, then Web Serial remains a normal channel and can be promoted by the runtime without devd.
- Given the same device is reachable through Web Serial and Wi-Fi/HTTP, when the runtime receives matching identity, then it updates one saved profile instead of creating a duplicate.
- Given devd owns a Local USB session, when another devd client requests the same port during an exclusive flash/reset, then devd returns a busy error instead of opening the port concurrently.
- Given a firmware catalog references an app image, when CLI/devd flashes a normal update, then the image hash, target, address, and identity are verified before writing.
- Given first-time hardware lacks identity, when a user runs a full flash, then the CLI shows target/artifact evidence, requires a typed confirmation, flashes the full artifact, and writes confirmed identity after reboot.
- Given CLI Wi-Fi set includes a PSK, when session traces or diagnostics are exported, then the PSK is redacted.
- Given the desktop app starts, when devd is available, then desktop UI uses the devd API rather than a divergent hardware-control implementation.

## Visual Evidence

Visual evidence for UI changes belongs to `docs/specs/u5b2c-usb-console-provisioning/SPEC.md` unless a future UI change is specific only to this daemon/CLI boundary.
