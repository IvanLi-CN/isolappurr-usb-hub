set shell := ["/bin/sh", "-c"]

# Default: list available recipes
default:
	@just --list

# Firmware (ESP32-S3 / Rust no_std)
fw-build:
	cargo build

fw-build-release:
	cargo build --release

fw-fmt:
	cargo +stable fmt

fw-clean:
	cargo clean

# Flash + monitor via espflash runner (set in .cargo/config.toml)
fw-ports:
	espflash scan-ports || espflash list-ports || true

fw-select-port:
	PORT="${PORT:-}" bash scripts/select_esp32_port.sh

fw-flash:
	PORT_SEL=$(bash scripts/ensure_esp32_port.sh) && \
	ESPFLASH_PORT="$PORT_SEL" cargo run

fw-flash-release:
	PORT_SEL=$(bash scripts/ensure_esp32_port.sh) && \
	ESPFLASH_PORT="$PORT_SEL" cargo run --release

# Web (React SPA / bun)
web-install:
	cd web && bun install

web-dev:
	cd web && bun dev

web-build:
	cd web && bun run build

web-preview:
	cd web && bun run preview

web-lint:
	cd web && bun run lint

web-check:
	cd web && bun run check

# Git hooks
hooks-install:
	lefthook install

all: fw-build web-build
