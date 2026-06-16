---
name: isolapurr-user-operations
description: "Operate IsolaPurr USB Hub from a user machine through released host tools and official Web paths: install released isolapurr/isolapurr-devd, prefer released CLI/devd flows over browser automation or localhost HTTP, keep Web Serial as a formal human browser path, use user-level hardware memory, and perform Wi-Fi, port, power, flash, reset, monitor, and diagnostics workflows only when the installed CLI exposes the command."
---

# IsolaPurr User Operations

Use this skill for owner-facing operation of released IsolaPurr USB Hub hardware on a normal user machine.

## Boundaries

- Use released host tools from GitHub Releases: `isolapurr` and `isolapurr-devd`.
- Agent-driven hardware operation defaults to released CLI/devd over local IPC, not browser automation, project-local source commands, or localhost HTTP.
- Web Serial is still an official human browser path. Use it when the owner explicitly wants browser Web Serial or is operating the Web UI directly.
- Do not require a source checkout, Rust, Bun, Just, `espflash`, or project-local caches for ordinary user operation.
- Treat the owner-visible hardware interfaces as `USB-A`, `USB-C`, and the `2 mm banana jack`.
- The `2 mm banana jack` is a bench output on the same TPS/SW2303 power channel as `USB-C`; it is not an independent power rail.
- For manual TPS / bench output that uses only the `2 mm banana jack`, keep the `USB-C` SW2303 VBUS path disconnected by default. Only leave `USB-C` powered when the owner explicitly requests shared output and accepts the attached-load risk.
- Before giving any hardware workflow, first verify both host tools are installed and usable:

```bash
isolapurr --help
isolapurr-devd --help
```

If either command is absent, this is an install gate: stop before hardware listing, scanning, status, provisioning, flashing, reset, monitor, or diagnostics. Do not list system USB or serial ports as a substitute result. Do not switch to browser automation, localhost HTTP, project-local source commands, raw serial tools, or source checkout workflows unless the owner explicitly switches to `isolapurr-developer-operations`.

If both commands exist but the requested subcommand is absent, stop and report that the installed release does not support the workflow. Do not invent commands or bypass with raw HTTP writes.

## Install Host Tools

- If `isolapurr` or `isolapurr-devd` is missing, install released host tools with the official installer from the chosen GitHub Release. Do not ask the user to clone the source repository.
- Before running the installer, show the user the release source, target version (`latest` unless specified), install directory, and PATH impact, then ask for confirmation.
- If the chosen GitHub Release or installer asset is unavailable, report the release/asset blocker and stop. Do not fall back to raw USB/serial enumeration or any unrelated hardware discovery path.
- macOS/Linux installer:

```bash
curl -fsSLO https://github.com/IvanLi-CN/isolappurr-usb-hub/releases/latest/download/install-isolapurr-host.sh
bash install-isolapurr-host.sh
```

- Windows installer:

```powershell
Invoke-WebRequest -Uri https://github.com/IvanLi-CN/isolappurr-usb-hub/releases/latest/download/install-isolapurr-host.ps1 -OutFile install-isolapurr-host.ps1
powershell -ExecutionPolicy Bypass -File .\install-isolapurr-host.ps1
```

- The installer downloads the matching host-tools archive, verifies it against `SHA256SUMS`, installs `isolapurr` and `isolapurr-devd` into a user-owned directory, and prints a PATH note when needed.
- Verify after installation:

```bash
isolapurr-devd --help
isolapurr --help
```

## Connect Hardware

- Only enter this section after `isolapurr --help` and `isolapurr-devd --help` both succeed.
- Start the local IPC daemon for long-running CLI/devd USB operation, or let `isolapurr` auto-start a sibling `isolapurr-devd` when the installed tools are packaged together. The IPC daemon exits after its idle timeout when no clients remain connected:

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
- If devd reports non-IsolaPurr firmware, download mode/no `info` response, or incompatible firmware, do not run ordinary Wi-Fi/port/power/diagnostic operations. Use first-time flash only after explicit target confirmation, or upgrade firmware when prompted.

## User Workflows

- Discovery and status:

```bash
isolapurr devices
isolapurr discover
isolapurr status --device-id <device-id>
isolapurr status --url http://<host-or-ip>
```

- Hardware memory:

```bash
isolapurr hardware path
isolapurr hardware save --device-id <device-id> --name <name> --port-path <port-path>
isolapurr hardware save --device-id <device-id> --name <name> --url http://<host-or-ip>
isolapurr hardware save --device-id <device-id> --name <name> --web-serial-label <label>
isolapurr hardware forget <device-id>
```

- Wi-Fi workflows are allowed only when `isolapurr wifi --help` exposes them:

```bash
isolapurr wifi show --device-id <device-id>
isolapurr wifi set --device-id <device-id> --ssid <ssid> --psk <psk>
isolapurr wifi clear --device-id <device-id>
```

- Port control is allowed only when the installed CLI exposes it. Verify status after writes:

```bash
isolapurr ports --device-id <device-id>
isolapurr ports --device-id <device-id> power --port <port-id> --enabled <true|false>
isolapurr ports --device-id <device-id> replug --port <port-id>
isolapurr ports --device-id <device-id> route --route <mcu|usb_c>
```

- Power workflows use the same released CLI surface and saved config path:

```bash
isolapurr power show --device-id <device-id>
isolapurr power config show --device-id <device-id>
isolapurr power config set --device-id <device-id> --tps-mode manual --voltage-mv 9000 --current-limit-ma 3000
isolapurr power output manual --device-id <device-id> --voltage-mv 9000 --current-limit-ma 3000 --usb-c-path disconnected
isolapurr power output auto --device-id <device-id>
isolapurr power source-capability set --device-id <device-id> --power-watts 65 --pd true --pps true
```

- Device settings reset and diagnostics export use the current released surface:

```bash
isolapurr settings reset other --device-id <device-id> --yes
isolapurr settings reset wifi --device-id <device-id> --yes
isolapurr diagnostics export --device-id <device-id>
```

- Firmware update must use release firmware catalog/assets. Run a dry-run or validation first when available, then flash only after target, artifact, hash, and identity evidence are clear.
- First-time full flash is user-supported only through the released CLI's explicit gate: exact port selection, artifact evidence, typed confirmation, and post-flash identity capture.
- Never echo PSKs or other secrets in chat, logs, screenshots, traces, or PR text.

## Stop Conditions

- Missing `isolapurr` or `isolapurr-devd`, unavailable release/installer asset, ambiguous target identity, missing command, missing firmware catalog, hash mismatch, target mismatch, busy Local USB session, unsupported Web Serial, or missing user confirmation before a destructive operation.
- If a requested workflow is only possible through source commands, switch to `isolapurr-developer-operations`.
