---
name: isolapurr-user-operations
description: "Operate IsolaPurr USB Hub from a user machine through released host tools and official Web paths: install released isolapurr/isolapurr-devd, prefer CLI/devd for Agent-driven hardware operations, keep Web Serial as a formal user UI path, use user-level hardware memory, perform Wi-Fi provisioning, status, port control, firmware catalog flashing, reset/monitor, and diagnostics only when the installed CLI exposes the command."
---

# IsolaPurr User Operations

Use this skill for owner-facing operation of released IsolaPurr USB Hub hardware on a normal user machine.

## Boundaries

- Use released host tools from GitHub Releases: `isolapurr` and `isolapurr-devd`.
- Agent-driven hardware operation defaults to CLI/devd over local IPC, not browser automation or localhost HTTP.
- Web Serial is still an official user path. Use it when the user is operating the Web UI directly or explicitly asks for browser Web Serial.
- Do not require a source checkout, Rust, Bun, Just, `espflash`, or project-local caches for ordinary user operation.
- Before giving a workflow, verify the installed CLI exposes it:

```bash
isolapurr --help
isolapurr-devd --help
```

If the command is absent, stop and report that the installed release does not support the workflow. Do not invent commands or bypass with raw HTTP writes.

## Install Host Tools

- Download the matching `isolapurr-host-tools-<platform>.tar.gz` from the chosen GitHub Release.
- Extract `isolapurr` and `isolapurr-devd` into a user-owned directory on `PATH`.
- Verify:

```bash
isolapurr-devd --help
isolapurr --help
```

## Connect Hardware

- Start the local IPC daemon for long-running CLI/devd USB operation, or let `isolapurr` auto-start a sibling `isolapurr-devd` when the installed tools are packaged together:

```bash
isolapurr-devd serve
```

- Prefer saved hardware before manual scanning:

```bash
isolapurr hardware list
isolapurr hardware recent
isolapurr hardware available --scan
```

- Use USB/devd IPC first for Agent-run hardware operations. Use `--url http://<host-or-ip>` only for direct device LAN HTTP, never as a way to connect the CLI to devd.
- Start `isolapurr-devd bridge-http` only when a browser or debug UI explicitly needs a localhost HTTP bridge.
- Do not auto-select a serial port. A hardware-changing operation must show target evidence first.

## User Workflows

- Identity and status:

```bash
isolapurr devices
isolapurr discover
isolapurr status --hardware <id>
isolapurr status --device <device-id>
isolapurr status --url http://<host-or-ip>
```

- Hardware memory:

```bash
isolapurr hardware path
isolapurr hardware save --id <id> --name <name> --transport usb --device <device-id>
isolapurr hardware save --id <id> --name <name> --transport http --url http://<host-or-ip>
isolapurr hardware forget <id>
```

- Wi-Fi provisioning is allowed only when `isolapurr wifi --help` exposes it. Never echo PSKs or secrets in chat, logs, screenshots, traces, or PR text.
- Port power/replug controls are allowed only when the installed CLI exposes the corresponding command. Verify status after writes.
- Firmware update must use release firmware catalog/assets. Run a dry-run or validation first when available, then flash only after target, artifact, hash, and identity evidence are clear.
- First-time full flash is user-supported only through the released CLI's explicit gate: exact port selection, artifact evidence, typed confirmation, and post-flash identity capture.

## Stop Conditions

- Ambiguous target identity, missing command, missing firmware catalog, hash mismatch, target mismatch, busy Local USB session, unsupported Web Serial, or missing user confirmation before a destructive operation.
- If a requested workflow is only possible through source commands, switch to `isolapurr-developer-operations`.
