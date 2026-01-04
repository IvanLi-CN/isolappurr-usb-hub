set shell := ["/bin/sh", "-c"]

# External mcu-agentd checkout (override if needed)
MCU_AGENTD_MANIFEST := env_var_or_default("MCU_AGENTD_MANIFEST", "../mcu-agentd/Cargo.toml")

# Default: list available recipes
default:
	@just --list

# Firmware (ESP32-S3 / Rust no_std)
build:
	cargo build --release

fmt:
	cargo +stable fmt

clean:
	cargo clean

# Port selection via mcu-agentd (cached in .esp32-port)
ports:
	mcu-agentd selector list usb_hub

select-port:
	@if [ -z "${PORT:-}" ]; then \
		echo "error: PORT is required." >&2; \
		echo "List candidates:" >&2; \
		echo "  just ports" >&2; \
		echo "Then select explicitly:" >&2; \
		echo "  PORT=/dev/cu.xxx just select-port" >&2; \
		exit 2; \
	fi
	mcu-agentd selector set usb_hub "$PORT"

flash:
	@if [ ! -f .esp32-port ]; then \
		echo "error: no port selected for this repo (.esp32-port missing)." >&2; \
		echo "Run:" >&2; \
		echo "  just ports" >&2; \
		echo "  PORT=/dev/cu.xxx just select-port" >&2; \
		exit 2; \
	fi
	@port="$(head -n 1 .esp32-port 2>/dev/null || true)"; \
	port="$(printf '%s' "$port" | tr -d '\r' | xargs)"; \
	if [ -z "$port" ] || [ ! -e "$port" ]; then \
		echo "error: cached port '$port' is not available." >&2; \
		echo "Run:" >&2; \
		echo "  just ports" >&2; \
		echo "  PORT=/dev/cu.xxx just select-port" >&2; \
		exit 2; \
	fi
	cargo build --release
	mcu-agentd flash usb_hub
	exec mcu-agentd monitor usb_hub --reset

monitor:
	exec mcu-agentd monitor usb_hub

reset:
	@if [ ! -f .esp32-port ]; then \
		echo "error: no port selected for this repo (.esp32-port missing)." >&2; \
		echo "Run:" >&2; \
		echo "  just ports" >&2; \
		echo "  PORT=/dev/cu.xxx just select-port" >&2; \
		exit 2; \
	fi
	@port="$(head -n 1 .esp32-port 2>/dev/null || true)"; \
	port="$(printf '%s' "$port" | tr -d '\r' | xargs)"; \
	if [ -z "$port" ] || [ ! -e "$port" ]; then \
		echo "error: cached port '$port' is not available." >&2; \
		echo "Run:" >&2; \
		echo "  just ports" >&2; \
		echo "  PORT=/dev/cu.xxx just select-port" >&2; \
		exit 2; \
	fi
	mcu-agentd reset usb_hub

# --- MCU agent daemon passthrough (recommended) ----------------------------

agentd +args:
	@if command -v mcu-agentd >/dev/null 2>&1; then \
		exec mcu-agentd {{args}}; \
	else \
		if [ ! -f "{{MCU_AGENTD_MANIFEST}}" ]; then \
			echo "[error] mcu-agentd not installed and manifest not found: {{MCU_AGENTD_MANIFEST}}" >&2; \
			echo "[hint] run: just agentd-init  (or set MCU_AGENTD_MANIFEST / MCU_AGENTD_PATH)" >&2; \
			exit 2; \
		fi; \
		MANIFEST="{{MCU_AGENTD_MANIFEST}}"; \
		DIR="$(dirname "$MANIFEST")"; \
		cd "$DIR"; \
		exec cargo run --manifest-path "$MANIFEST" --bin mcu-agentd --release -- {{args}}; \
	fi

# Install mcu-agentd/mcu-managerd from a local checkout.
_agentd-install path="":
	@set -eu; \
	REPO="{{path}}"; \
	if [ "$REPO" = "path=" ]; then REPO=""; fi; \
	if [ -z "$REPO" ]; then REPO="${MCU_AGENTD_PATH:-../mcu-agentd}"; fi; \
	if [ ! -d "$REPO" ]; then \
		echo "mcu-agentd repo not found at: $REPO" >&2; \
		echo "Usage: just agentd-init path=/path/to/mcu-agentd" >&2; \
		echo "   or: MCU_AGENTD_PATH=/path/to/mcu-agentd just agentd-init" >&2; \
		exit 2; \
	fi; \
	cd "$REPO"; \
	cargo install --force --path . --bins; \
	mcu-agentd --version; \
	mcu-managerd --version

agentd-init path="":
	@just agentd stop >/dev/null 2>&1 || true
	@if [ -z "{{path}}" ]; then \
		just _agentd-install; \
	else \
		just _agentd-install path="{{path}}"; \
	fi
	@just agentd-start

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

web:
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

all: build web-build
