set shell := ["/bin/sh", "-c"]

ROOT := justfile_directory()
DESKTOP_DIR := ROOT + "/desktop/src-tauri"
FIRMWARE_ELF := ROOT + "/target/xtensa-esp32s3-none-elf/release/isolapurr-usb-hub"
FIRMWARE_BIN := ROOT + "/target/xtensa-esp32s3-none-elf/release/isolapurr-usb-hub.app.bin"

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

sw2303-test:
	./tools/test-sw2303-host.sh

# Local USB development tools via isolapurr-desktop.
_desktop-dist:
	@if [ ! -f desktop/dist/index.html ]; then \
		if [ ! -d web/node_modules ]; then \
			cd web && bun install; \
		fi; \
		cd web && bun run build; \
		cd ../desktop && ISOLAPURR_SKIP_WEB_BUILD=1 bun scripts/tauri-before-build.ts; \
	fi

desktop-agent +args:
	@just _desktop-dist
	@cd {{DESKTOP_DIR}} && ISOLAPURR_REPO_ROOT={{ROOT}} cargo run -- {{args}}

local-ports:
	@just desktop-agent serial ports

local-identify:
	@if [ -z "${PORT:-}" ]; then \
		echo "error: PORT is required." >&2; \
		echo "List candidates:" >&2; \
		echo "  just local-ports" >&2; \
		echo "Then confirm explicitly:" >&2; \
		echo "  PORT=/dev/cu.xxx just local-identify" >&2; \
		exit 2; \
	fi
	@just desktop-agent serial identify --port "$PORT" --write-cache

firmware-bin:
	cargo build --release
	@just desktop-agent firmware make-bin --elf {{FIRMWARE_ELF}} --out {{FIRMWARE_BIN}}

_local-confirmed-port:
	@if [ ! -f .esp32-port ]; then \
		echo "error: no port selected for this repo (.esp32-port missing)." >&2; \
		echo "Run:" >&2; \
		echo "  just local-ports" >&2; \
		echo "  PORT=/dev/cu.xxx just local-identify" >&2; \
		exit 2; \
	fi; \
	if [ ! -f .esp32-port.identity.json ]; then \
		echo "error: no confirmed device identity (.esp32-port.identity.json missing)." >&2; \
		echo "Run:" >&2; \
		echo "  PORT=/dev/cu.xxx just local-identify" >&2; \
		exit 2; \
	fi; \
	port="$(head -n 1 .esp32-port 2>/dev/null || true)"; \
	port="$(printf '%s' "$port" | tr -d '\r' | xargs)"; \
	if [ -z "$port" ] || [ ! -e "$port" ]; then \
		echo "error: cached port '$port' is not available." >&2; \
		echo "Run:" >&2; \
		echo "  just local-ports" >&2; \
		echo "  PORT=/dev/cu.xxx just local-identify" >&2; \
		exit 2; \
	fi; \
	printf '%s\n' "$port"

local-flash:
	@port="$(just _local-confirmed-port)"; \
	just firmware-bin; \
	just desktop-agent firmware flash --port "$port" --bin {{FIRMWARE_BIN}} --address 0x10000

local-reset:
	@port="$(just _local-confirmed-port)"; \
	just desktop-agent firmware reset --port "$port"

local-monitor:
	@port="$(just _local-confirmed-port)"; \
	cd {{DESKTOP_DIR}} && exec env ISOLAPURR_REPO_ROOT={{ROOT}} cargo run -- firmware monitor --port "$port"

local-flash-monitor:
	@port="$(just _local-confirmed-port)"; \
	just firmware-bin; \
	just desktop-agent firmware flash --port "$port" --bin {{FIRMWARE_BIN}} --address 0x10000; \
	cd {{DESKTOP_DIR}} && exec env ISOLAPURR_REPO_ROOT={{ROOT}} cargo run -- firmware monitor --port "$port" --reset

# Backwards-compatible aliases now use project-local Local USB tools.
ports:
	@just local-ports

select-port:
	@just local-identify

flash:
	@just local-flash-monitor

monitor:
	@just local-monitor

reset:
	@just local-reset

# Legacy/emergency passthrough only. Local USB is the default development path.
legacy-agentd +args:
	@if ! command -v mcu-agentd >/dev/null 2>&1; then \
		echo "[error] mcu-agentd is not installed. It is legacy/emergency only; use just local-*." >&2; \
		exit 127; \
	fi; \
	exec mcu-agentd {{args}}

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
