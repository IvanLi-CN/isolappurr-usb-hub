# Repository Guidelines

## Project Structure & Module Organization

- Firmware (ESP32‑S3, Rust `no_std`): `src/`, `Cargo.toml`, `.cargo/config.toml`, `tools/espflash-runner`
- Web UI (React SPA): `web/` (see `web/src/`, `web/public/`, `web/vite.config.ts`)
- Docs & datasheets: `docs/`
- CI/deploy: `.github/workflows/pages.yml` builds `web/dist` for GitHub Pages

## Build, Test, and Development Commands

Prefer `Justfile`:

- `just fw-build` / `just fw-build-release` — build firmware
- `just fw-flash /dev/tty.usbserial-XXXX` — flash + monitor (serial port must be explicit)
- `just web-install` / `just web-dev` / `just web-build` — install/run/build the SPA
- `just web-check` — run Biome checks
- `just hooks-install` — install Git hooks (lefthook)

Direct equivalents:

- Firmware: `cargo build`, `ESPFLASH_PORT=/dev/ttyXXX cargo run`
- Web: `cd web && bun install && bun dev`

## Coding Style & Naming Conventions

- Rust: `rustfmt` (edition 2024). Keep firmware `#![no_std]`; avoid heap unless justified. Use `snake_case` for modules/functions.
- Web: Biome enforces 2‑space indentation and double quotes. Use `cd web && bun run format` and `bun run check`.

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
- Flashing requires an explicit serial port: set `ESPFLASH_PORT` (auto-selection is intentionally disabled).

## License

Unless noted otherwise, this repository is dual-licensed under `MIT OR Apache-2.0` (see `LICENSE-MIT` and `LICENSE-APACHE`).
