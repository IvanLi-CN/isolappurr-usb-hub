set shell := ["/bin/sh", "-c"]

ROOT := justfile_directory()
DESKTOP_DIR := ROOT + "/desktop/src-tauri"
HOST_TOOLS_MANIFEST := ROOT + "/tools/isolapurr-host/Cargo.toml"
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

# Released-style host tools (isolapurr CLI + isolapurr-devd).
host-tools-build:
	@host="$(rustc +stable -vV | sed -n 's/^host: //p')"; \
	cargo +stable build --manifest-path {{HOST_TOOLS_MANIFEST}} --bins --target "$host"

host-tools-test:
	@host="$(rustc +stable -vV | sed -n 's/^host: //p')"; \
	cargo +stable test --manifest-path {{HOST_TOOLS_MANIFEST}} --target "$host"

devd-serve +args:
	@host="$(rustc +stable -vV | sed -n 's/^host: //p')"; \
	cargo +stable run --manifest-path {{HOST_TOOLS_MANIFEST}} --target "$host" --bin isolapurr-devd -- serve {{args}}

devd-http-bridge +args:
	@host="$(rustc +stable -vV | sed -n 's/^host: //p')"; \
	cargo +stable run --manifest-path {{HOST_TOOLS_MANIFEST}} --target "$host" --bin isolapurr-devd -- bridge-http {{args}}

isolapurr +args:
	@host="$(rustc +stable -vV | sed -n 's/^host: //p')"; \
	cargo +stable build --manifest-path {{HOST_TOOLS_MANIFEST}} --bins --target "$host" >/dev/null; \
	cargo +stable run --manifest-path {{HOST_TOOLS_MANIFEST}} --target "$host" --bin isolapurr -- {{args}}

sw2303-test:
	./tools/test-sw2303-host.sh

# Local USB development tools via isolapurr-desktop.
_desktop-dist:
	@if [ ! -f desktop/dist/index.html ]; then \
		if [ ! -d web/node_modules ]; then \
			(cd web && bun install); \
		fi; \
		(cd web && bun run build); \
		(cd desktop && ISOLAPURR_SKIP_WEB_BUILD=1 bun scripts/tauri-before-build.ts); \
		fi

desktop-agent-build:
	@just _desktop-dist
	@host="$(rustc -vV | sed -n 's/^host: //p')"; \
	cd {{DESKTOP_DIR}} && cargo build --target "$host"

_desktop-agent-bin:
	@host="$(rustc -vV | sed -n 's/^host: //p')"; \
	bin=""; \
	for candidate in \
		{{DESKTOP_DIR}}/target/$host/debug/isolapurr-desktop \
		{{DESKTOP_DIR}}/target/$host/release/isolapurr-desktop \
		{{DESKTOP_DIR}}/target/debug/isolapurr-desktop \
		{{DESKTOP_DIR}}/target/release/isolapurr-desktop; do \
		if [ -x "$candidate" ]; then \
			bin="$candidate"; \
			break; \
		fi; \
	done; \
	if [ -z "$bin" ]; then \
		echo "error: isolapurr-desktop CLI is not built." >&2; \
		echo "Run once:" >&2; \
		echo "  just desktop-agent-build" >&2; \
		exit 2; \
	fi; \
	printf '%s\n' "$bin"

desktop-agent +args:
	@bin="$(just _desktop-agent-bin)" || exit $?; \
	ISOLAPURR_REPO_ROOT={{ROOT}} exec "$bin" {{args}}

ports:
	@just desktop-agent serial ports

identify:
	@if [ -z "${PORT:-}" ]; then \
		echo "error: PORT is required." >&2; \
		echo "List candidates:" >&2; \
		echo "  just ports" >&2; \
		echo "Then confirm explicitly:" >&2; \
		echo "  PORT=/dev/cu.xxx just identify" >&2; \
		echo "Or run the interactive selector:" >&2; \
		echo "  just select-port" >&2; \
		exit 2; \
	fi
	@just desktop-agent serial identify --port "$PORT" --write-cache

firmware-bin:
	cargo build --release
	@just desktop-agent firmware make-bin --elf {{FIRMWARE_ELF}} --out {{FIRMWARE_BIN}}

_local-selected-port:
	@if [ ! -f .esp32-port ]; then \
			echo "error: no port selected for this repo (.esp32-port missing)." >&2; \
			echo "Run:" >&2; \
			echo "  just select-port" >&2; \
			exit 2; \
		fi; \
		port="$(head -n 1 .esp32-port 2>/dev/null || true)"; \
	port="$(printf '%s' "$port" | tr -d '\r' | xargs)"; \
		if [ -z "$port" ] || [ ! -e "$port" ]; then \
			echo "error: cached port '$port' is not available." >&2; \
			echo "Run:" >&2; \
			echo "  just select-port" >&2; \
			exit 2; \
		fi; \
		printf '%s\n' "$port"

_local-confirmed-port:
	@if [ ! -f .esp32-port ]; then \
			echo "error: no port selected for this repo (.esp32-port missing)." >&2; \
			echo "Run:" >&2; \
			echo "  just select-port" >&2; \
			exit 2; \
		fi; \
		if ! grep -Eq '^(device_id|deviceId|mac)=' .esp32-port; then \
			echo "error: no confirmed device identity in .esp32-port." >&2; \
			echo "If this is first-time hardware or download mode, run:" >&2; \
			echo "  just flash" >&2; \
			echo "After the project firmware is running, run:" >&2; \
			echo "  PORT=/dev/cu.xxx just identify" >&2; \
			exit 2; \
		fi; \
		just _local-selected-port

flash:
	@port="${PORT:-}"; \
	if [ -n "$port" ]; then \
		port="$(printf '%s' "$port" | tr -d '\r' | xargs)"; \
	else \
		port="$(just _local-selected-port)" || exit $?; \
	fi; \
	if [ -z "$port" ] || [ ! -e "$port" ]; then \
		echo "error: selected port '$port' is not available." >&2; \
		echo "Run:" >&2; \
		echo "  just select-port" >&2; \
		exit 2; \
	fi; \
	just firmware-bin && \
	just desktop-agent firmware flash --port "$port" --bin {{FIRMWARE_BIN}} --elf {{FIRMWARE_ELF}} --address 0x10000 --allow-unconfirmed-port

reset:
	@port="$(just _local-confirmed-port)" || exit $?; \
	just desktop-agent firmware reset --port "$port"

monitor:
	@port="$(just _local-confirmed-port)" || exit $?; \
	just desktop-agent firmware monitor --port "$port" --elf {{FIRMWARE_ELF}}

flash-monitor:
	@port="$(just _local-confirmed-port)" || exit $?; \
	just firmware-bin && \
	just desktop-agent firmware flash --port "$port" --bin {{FIRMWARE_BIN}} --address 0x10000 && \
	just desktop-agent firmware monitor --port "$port" --elf {{FIRMWARE_ELF}} --reset

select-port:
	@tmp="$(mktemp)"; \
	trap 'rm -f "$tmp"' EXIT HUP INT TERM; \
	if ! just ports | awk -F '\t' '$1 ~ /^\/dev\// || $1 ~ /^[Cc][Oo][Mm][0-9]+$/ { print }' >"$tmp"; then \
		exit $?; \
	fi; \
	if [ ! -s "$tmp" ]; then \
		echo "error: no ESP32-S3 USB Serial/JTAG candidates found." >&2; \
		exit 2; \
	fi; \
	if command -v fzf >/dev/null 2>&1 && [ -t 0 ]; then \
		selected="$(fzf --prompt='Select target port > ' --height=~40% --reverse --border --no-multi <"$tmp")" || { echo "aborted"; exit 2; }; \
		port="$(printf '%s\n' "$selected" | awk -F '\t' '{ print $1 }')"; \
	else \
		echo "ESP32-S3 USB Serial/JTAG candidates:"; \
		awk -F '\t' '{ printf "  [%d] %s", NR, $1; for (i = 2; i <= NF; i++) printf "\t%s", $i; printf "\n" }' "$tmp"; \
		printf "Select target by number or full port path: "; \
		read choice; \
		case "$choice" in \
			/dev/*) port="$choice" ;; \
			*[!0-9]*|"") echo "error: invalid selection '$choice'." >&2; exit 2 ;; \
			*) port="$(awk -F '\t' -v n="$choice" 'NR == n { print $1 }' "$tmp")" ;; \
		esac; \
	fi; \
	if [ -z "$port" ]; then \
		echo "error: no target port selected." >&2; \
		exit 2; \
	fi; \
	printf "Confirm target port %s? Type 'yes' to continue: " "$port"; \
	read confirm; \
	if [ "$confirm" != "yes" ]; then \
		echo "aborted"; \
		exit 2; \
	fi; \
	just desktop-agent serial identify --port "$port" --write-cache --allow-unconfirmed-cache

# Legacy/emergency passthrough only. Local USB is the default development path.
legacy-agentd +args:
	@if ! command -v mcu-agentd >/dev/null 2>&1; then \
		echo "[error] mcu-agentd is not installed. It is legacy/emergency only; use just ports / just flash-monitor." >&2; \
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
