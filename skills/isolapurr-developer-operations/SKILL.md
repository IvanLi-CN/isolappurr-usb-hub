---
name: isolapurr-developer-operations
description: "Develop, maintain, release, and debug IsolaPurr USB Hub as a superset of isolapurr-user-operations: verify source checkout, use Just, build firmware/Web/desktop/host-tools, run isolapurr-devd and isolapurr from source, maintain firmware catalogs and release assets, perform HIL, first-flash, calibration, Web Serial, Local USB, and CI/PR validation."
---

# IsolaPurr Developer Operations

Use this skill for source checkout work, maintenance, release engineering, HIL/debug sessions, and implementing missing user-facing capabilities.

This skill inherits `isolapurr-user-operations`: ordinary hardware operation still prefers released-style CLI/devd flows, target evidence, hardware memory, Web Serial as an official path, and command-availability gates.

## Checkout Gate

Before project commands, prove the current directory is an IsolaPurr checkout:

```bash
git rev-parse --show-toplevel
test -f Justfile
test -f Cargo.toml
test -d web
test -d desktop
```

## Source Commands

- Build firmware: `just build`
- Build host tools from source: `just host-tools-build`
- Test host tools from source: `just host-tools-test`
- Run IPC devd from source: `just devd-serve`
- Run the explicit localhost HTTP bridge for browser/debug UI only: `just devd-http-bridge --bind 127.0.0.1:<port>`
- Run CLI from source over IPC: `just isolapurr <args>`
- Web checks: `cd web && bun run check && bun run build && bun run test:unit`
- Storybook checks when UI changes: `cd web && bun run build-storybook && bun run test:storybook`
- Desktop checks: `cd desktop/src-tauri && cargo test`

## Hardware Safety

- Never auto-select a serial port.
- For development flashing, use owner-confirmed `.esp32-port` only after the exact path is approved or selected through the project selector.
- First-time full flash requires explicit confirmation and post-flash identity capture.
- Do not use `mcu-agentd` except as a legacy/emergency path.
- Keep Web Serial as an official product path. Do not downgrade it to debug-only while implementing devd.

## Release Maintenance

- Release assets must include desktop bundles, host-tools archives with `isolapurr` and `isolapurr-devd`, firmware catalog, and referenced firmware artifacts.
- Do not document a user workflow as available until the released CLI exposes it and the release contains the required assets.
- Firmware catalog changes must preserve target, address, hash, version, and build provenance.

## Validation

- Match validation to the changed surface, but PR-ready work for CLI/devd alignment must run full Rust/Web/Desktop/Firmware/Release gates when practical.
- HIL evidence must identify transport, target, session or lease, artifact identity, and observed protocol result.
