# Implementation

## Current coverage

- `isolapurr-devd` and `isolapurr` host-tools package added under `tools/isolapurr-host`.
- `isolapurr-devd serve` exposes a local IPC daemon by default: Unix domain socket on macOS/Linux and Windows named pipe on Windows. It tracks connected IPC clients and exits after the configured idle timeout when no clients remain.
- `isolapurr-devd bridge-http` exposes the device-centric localhost HTTP bridge, token bootstrap, Local USB scanning, leases, session traces, storage import/list/save, Wi-Fi/ports/status/route/diagnostics/power-config proxy methods, firmware catalog validation, and guarded flash/reset endpoints.
- `isolapurr` exposes released-style CLI entrypoints for hardware memory, discovery/devices/status, Wi-Fi, ports, flash, reset, monitor, and diagnostics over IPC, with sibling daemon auto-start when available.
- The Web app now exposes a standalone `/flash` workbench with a
  left-column/right-rail flashing layout, a bundled release picker, and entry
  points from both the Dashboard add-device area and device Settings.
- `isolapurr settings reset wifi|other`, IPC `device.settings.reset`, and `POST /api/v1/devices/{id}/settings/reset` are implemented with the same transport guardrails as the device firmware contract. Local USB `scope=other` now tolerates a brief serial drop during runtime default re-apply by re-reading route and power state after reconnect before returning success.
- `isolapurr discover` now performs actual mixed discovery: LAN candidates come
  from mDNS/DNS-SD `_http._tcp.local` browsing plus verified `GET /api/v1/info`
  responses, Local USB candidates come from the current devd scan, and saved
  device profiles are attached back as annotations when identity or transport
  keys match. The owner-facing render now chooses one canonical saved record
  per live result, preferring the same transport before identity-only fallbacks.
- The next contract sync locks owner-facing selectors to full 12-character
  `device_id`, while `port_path` remains the only advanced Local USB selector.
  Saved hardware IDs and temporary devd scan IDs are no longer valid
  owner-facing identity terms.
- `isolapurr` now also exposes owner-facing power commands over the same IPC
  path: `power show`, `power defaults`, `power output manual|auto`, and
  `power source-capability set`.
- `isolapurr power config show|set` now fronts the whole saved power-config
  surface directly. `show` returns the persisted config snapshot, and `set`
  reads the current config first, mutates only explicitly provided fields such
  as `light_load_mode`, `tps_mode`, manual output, or source-capability flags,
  then writes the merged payload back through `power.config_set`.
- The CLI power flow reads the whole persisted config, mutates only the
  requested source-capability fields requested by the user, including protocol
  toggles, PD options, power cap, and current tiers, and writes the full config
  back through the aligned `power.config_*` transport contract.
- `power output manual` switches the saved output mode to manual and updates
  only the requested manual voltage/current/path fields while preserving the
  existing source-capability profile; `power output auto` switches back to
  automatic request tracking without clearing the saved manual target.
- The aligned power-config contract now includes top-level
  `light_load_mode: "pfm" | "fpwm"` across host JSON, Local USB JSONL, and
  device bridge HTTP responses, with host-side normalization defaulting missing
  legacy values to `pfm`.
- The bridge-facing Web client now serializes `power/config` writes from a
  writable-only request model so read-only response decorations such as
  `manual.path_policy` never leak back into the aligned `PUT /power/config`
  contract.
- `power source-capability set` now has a terminal-only interactive mode when
  no update flags are supplied: it reads current config plus live status first,
  then renders a `ratatui`-based inline chip editor: one source-capability
  field per row, row-local choices on the same line, `Up/Down` field
  navigation, `Left/Right` inline choice changes, `Enter/Space` chip toggles,
  and an inline action row for reload and save/apply.
  When the owner does not supply `--device-id`, the CLI now prompts from saved
  devices only; power commands no longer accept temporary devd `--device`
  selectors or direct `--url` targets.
- Human-readable `power show` and `power defaults` output now translates the
  underlying chip-specific config/diagnostics payload into product-language
  summaries, while `--json` keeps the transport-shaped payload for automation.
- `power defaults` now shares the same timeout-recovery behavior as config
  writes: after a serial timeout it re-reads the saved config and returns
  success when the expected default profile actually applied.
- Added a live Playwright regression over `isolapurr-devd bridge-http` so the
  built Web page exercises the same aligned `power/config` contract that the
  CLI and bridge expose, instead of relying only on mock Storybook coverage.
- Local USB operations verify project firmware metadata from `info` before ordinary control paths. Non-project firmware, download-mode/no-JSONL targets, and incompatible firmware versions are rejected with corrective guidance; first-time full flash requires explicit confirmation.
- Web Local USB discovery/request/flash code now targets the new `/api/v1/devices/*` and lease APIs while leaving Web Serial intact. Device profiles can retain HTTP and Local USB transports for one hardware identity, and the runtime prefers successful Local USB operations for unsupported or unreachable Wi-Fi/HTTP paths.
- Bridge HTTP now also accepts `POST /api/v1/devices/{id}/flash-bundled`,
  where the Web UI uploads a selected same-origin bundled asset plus its
  catalog metadata. Host-side validation reuses the firmware catalog guardrails
  for target, address, hash, and identity checks before writing.
- Browser runtime flash selection now defaults to a same-origin bundled release
  manifest under `web/public/firmware/`. Release builds replace the checked-in
  empty manifest by downloading the most recent 50 non-draft GitHub Releases,
  bundling app images for all 50 versions, and bundling recovery images only
  for the latest stable plus latest prerelease, preferring `full_image`
  artifacts. When a legacy release only ships an `elf` recovery artifact, the
  bundler now synthesizes a merged same-origin `full_image` plus a matching
  local catalog entry so Web Serial and Local USB recovery can share one
  bundled recovery contract without falling back to the plain app image.
- Recovery writes from the `/flash` workbench now separate flash mode from
  target trust: confirmed IsolaPurr targets may choose either a normal update
  or a bundled recovery image, while non-project or identity-unknown recovery
  targets still require the stronger confirmation dialog before write.
- Host-side recovery flashing now releases the serial lock before post-flash
  identity capture while preserving the exclusive flash guard, preventing the
  Local USB recovery path from self-blocking during the reboot/probe handoff.
- Local USB recovery writes no longer force the non-project confirmation path
  for already confirmed IsolaPurr hardware. When the owner selects recovery on
  a confirmed target, devd keeps the identity guard and allows the write
  without pretending the board is unknown or foreign.
- Repository skills added under `skills/isolapurr-user-operations` and `skills/isolapurr-developer-operations`.
- Repo-managed workflow truth is now split cleanly by responsibility: `isolapurr-user-operations` tracks the released CLI surface, `isolapurr-developer-operations` tracks source/developer flows, `isolapurr-maintainer-workflow` is the repo-private router, `docs/maintainer-workflow.md` is the detailed maintainer doc, `README.md` handles human navigation, and `AGENTS.md` stays as the concise entry contract.
- Repo-managed Web verification guidance now also points to the dedicated
  `kvbq9` policy spec, and repo-contract tests watch `README.md`,
  `web/README.md`, `AGENTS.md`, `docs/maintainer-workflow.md`, `web/src/App.tsx`,
  and `web/src/pages/**` so page-level stories, extra `/demo/*` pages, and
  uncontrolled demo routes cannot drift back in silently.
- `isolapurr-user-operations` treats missing released host tools and unavailable installer assets as hard stop conditions before hardware enumeration or operations.
- CI/release workflows build and publish host-tools plus firmware catalog assets.
- CI runs Python contract tests for release-intent and skill/install-gate consistency.
- `host-tools.yml` builds/tests/packages host-tools archives for Linux, macOS, and Windows.
- Official host-tools installers added for Unix and Windows. Tag builds publish the host-tools archives, `SHA256SUMS`, and installer scripts to the matching GitHub Release.
- `firmware.yml` emits a firmware catalog artifact after firmware build.
- `firmware.yml` and `release.yml` now also emit `isolapurr-usb-hub.full.bin`
  plus recovery artifact metadata, with `app.bin` generated from the plain
  app image and `full.bin` generated from a merged, skip-padding recovery
  image. Release builds also run the Web firmware bundler before publishing
  the Web distribution tarball.
- Removed the repo-managed legacy command examples that still referenced old released forms such as `status --hardware`, `status --device`, and `hardware save --id/--transport`, and added contract tests plus CLI parser tests so that drift fails CI instead of silently reappearing.

## Remaining hardening

- Complete removal of the legacy Tauri-owned hardware-control server once the desktop packaging flow can bundle or locate `isolapurr-devd` at runtime.
- Expand mock and hardware-in-loop coverage as physical devices are available.

## Audit Task Checklist

- `F1` Web Serial `probe -> flash` transport-release defect fixed: completed
- `F2` Web Serial regression tests/build after the transport-release fix: completed
- `F3` devd / Local USB page fixed to read project firmware identity from the registered device-status path instead of the legacy `serial/request info` fallback: completed
- `F4` devd / Local USB regression tests/build after the identity-path fix: completed

- `D1` devd / Local USB connection shows page fields aligned with `/serial/board-info` and `/devices/{id}/status`: completed
- `D2` devd / Local USB recovery flash succeeds on real hardware: completed
- `D3` devd / Local USB recovery same-page re-probe refreshes to the post-flash real values: completed
- `D4` devd / Local USB normal update succeeds on real hardware: completed
- `D5` devd / Local USB normal update same-page re-probe refreshes to the post-flash real values: completed
- `D6` devd / Local USB audit materials written to disk (`JSON`, screenshots, bridge evidence, steps): completed

- `W1` Web Serial connection shows page fields aligned with hardware / firmware truth: completed
- `W2` Web Serial recovery flash succeeds on real hardware: completed
- `W3` Web Serial recovery same-page re-probe refreshes to the post-flash real values: completed
- `W4` Web Serial normal update succeeds on real hardware: completed
- `W5` Web Serial normal update same-page re-probe refreshes to the post-flash real values: completed
- `W6` Web Serial audit materials written to disk (`JSON`, screenshots, steps): completed

- `A1` Repair notes, test evidence, and visual evidence synced into the audit/spec surfaces: completed
- `A2` Final acceptance audit over every explicit requirement: completed
- `A3` Local signed-off commit to lock the result: pending
