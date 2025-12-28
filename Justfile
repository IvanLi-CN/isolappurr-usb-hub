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

# Port selection via espflash (cached in .esp32-port)
fw-ports:
	espflash list-ports --skip-update-check || true

fw-select-port:
	PORT="${PORT:-}" bash scripts/select_esp32_port.sh

fw-flash:
	cargo build
	mcu-agentd flash usb_hub_dev
	exec mcu-agentd monitor usb_hub_dev --reset

fw-flash-release:
	cargo build --release
	mcu-agentd flash usb_hub
	exec mcu-agentd monitor usb_hub --reset

fw-monitor:
	exec mcu-agentd monitor usb_hub

fw-monitor-dev:
	exec mcu-agentd monitor usb_hub_dev

fw-reset:
	mcu-agentd reset usb_hub

fw-reset-dev:
	mcu-agentd reset usb_hub_dev

# --- MCU agent daemon passthrough (recommended) ----------------------------

# Installs `mcu-agentd` (host binary) from ~/Projects/Ivan/mcu-agentd
agentd-install:
	cd "$HOME/Projects/Ivan/mcu-agentd" && cargo install --path . --locked --force

agentd +args:
	@if command -v mcu-agentd >/dev/null 2>&1; then \
		exec mcu-agentd {{args}}; \
	else \
		echo "mcu-agentd not found in PATH. Install it with: just agentd-install" >&2; \
		exit 1; \
	fi

agentd-start:
	just agentd start

agentd-status:
	just agentd status

agentd-stop:
	just agentd stop

agentd-config-validate:
	just agentd config validate

agentd-mcu-list:
	just agentd mcu list

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
