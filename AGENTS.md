# Repository Guidelines

## Project Structure & Module Organization

- Firmware (ESP32‑S3, Rust `no_std`): `src/`, `Cargo.toml`, `.cargo/config.toml`, `tools/mcu-agentd-runner` (Local USB runner)
- Web UI (React SPA): `web/` (see `web/src/`, `web/public/`, `web/vite.config.ts`)
- Docs & datasheets: `docs/`
- Hardware variants & netlists: `hardware/` (per-variant artifacts; see `docs/hardware-variants.md`)
- CI/deploy: `.github/workflows/pages.yml` builds `web/dist` for GitHub Pages

## Build, Test, and Development Commands

Prefer `Justfile`:

- `just build` — build firmware with the Local USB JSONL console (`cargo build --release`)
- `just desktop-agent-build` — build the project-local `isolapurr-desktop` CLI once before using `just ports` on a fresh checkout
- `just desktop-agent` — run the project-local `isolapurr-desktop` CLI
- `just ports` — list ESP32-S3 USB Serial/JTAG candidates
- `PORT=/dev/cu.xxx just identify` — read JSONL `info` and persist the owner-confirmed port plus identity into `.esp32-port`
- `just firmware-bin` — build firmware and generate the app `.bin`
- `just flash` — identity-check and flash the app `.bin` at `0x10000`
- `just reset` / `just monitor` — reset or monitor through Local USB
- `just flash-monitor` — build, make app `.bin`, identity-check flash, reset, and monitor
- `just web-install` / `just web` / `just web-build` — install/run/build the SPA
- `just web-check` — run Biome checks
- `just hooks-install` — install Git hooks (lefthook)

Direct equivalents:

- Firmware (recommended): `just flash-monitor`
- Firmware (via cargo runner): `cargo run --release` (invokes `tools/mcu-agentd-runner`, now a Local USB runner)
- Web: `cd web && bun install && bun dev`

## Coding Style & Naming Conventions

- Rust: `rustfmt` (edition 2024). Keep firmware `#![no_std]`; avoid heap unless justified. Use `snake_case` for modules/functions.
- Web: Biome enforces 2‑space indentation and double quotes. Use `cd web && bun run format` and `bun run check`.
- Hardware variant artifacts: keep the current scheme name (`tps-sw`) in `hardware/tps-sw/`; place the active netlist at `hardware/tps-sw/netlist.enet` and update `docs/hardware-variants.md`.

## Testing Guidelines

There are no dedicated test suites yet. At minimum, keep:

- `cargo build` passing for firmware
- `cd web && bun run check && bun run build` passing for the SPA

## Commit & Pull Request Guidelines

- Use Conventional Commits in English (e.g. `feat: add i2c driver`, `chore: update deps`).
- Run `bun install` at repo root to enable commitlint; hooks run via lefthook.
- Commits should be signed off: `git commit --signoff -m "chore: ..."`.
- PRs: include a clear description, list commands run, and add screenshots for UI changes.

## Security & Configuration

- Never commit secrets. Use local env files (e.g. `.env`) for machine-specific settings.
- Flashing requires an explicit Local USB identity confirmation in `.esp32-port` (auto-selection is intentionally disabled).
- Flashing safety: only flash to the owner-confirmed port for this project. The Local USB runner must read JSONL `info` and match `device_id` / `mac` before `espflash write-bin`.
- Tools must never auto-select a port (even if only one port exists). If `.esp32-port` is missing or lacks `device_id`/`mac`, error out and instruct the user to run `just ports` and then `PORT=/dev/cu.xxx just identify`.
- Do not set `PORT=...` unless the owner explicitly provided the exact device path. If the expected port is missing or multiple ports exist, stop and ask the owner to confirm/re-select the port.
- `mcu-agentd` is legacy/emergency only and must not be recommended as the default development path.

## License

Unless noted otherwise, this repository is dual-licensed under `MIT OR Apache-2.0` (see `LICENSE-MIT` and `LICENSE-APACHE`).
