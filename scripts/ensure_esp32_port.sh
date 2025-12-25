#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
CACHE_FILE="$REPO_ROOT/.esp32-port"

err() { printf '%s\n' "$1" >&2; }

if ! command -v espflash >/dev/null 2>&1; then
  err "[esp32-port] espflash not found; install via 'cargo install espflash'"
  exit 127
fi

if [ -n "${PORT:-}" ]; then
  err "[esp32-port] refusing to use PORT=... here."
  err "[esp32-port] Select the port explicitly via:"
  err "[esp32-port]   just fw-ports"
  err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
  exit 2
fi

PORT_LIST=$(espflash list-ports --name-only --skip-update-check 2>/dev/null)
if [ -z "$PORT_LIST" ]; then
  err "[esp32-port] no ESP32 serial ports detected."
  err "[esp32-port] Run: just fw-ports"
  err "[esp32-port] Then select explicitly:"
  err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
  exit 1
fi

ALL_PORTS=()
while IFS= read -r line; do
  [ -n "$line" ] && ALL_PORTS+=("$line")
done <<<"$PORT_LIST"

contains_port() {
  local needle="$1"
  shift || true
  local entry
  for entry in "$@"; do
    if [ "$entry" = "$needle" ]; then
      return 0
    fi
  done
  return 1
}

if [ -f "$CACHE_FILE" ]; then
  cached=$(cat "$CACHE_FILE" 2>/dev/null || true)
  if [ -n "$cached" ] && contains_port "$cached" "${ALL_PORTS[@]}"; then
    echo "$cached"
    exit 0
  fi
  err "[esp32-port] cached port '$cached' is not available."
  err "[esp32-port] Run: just fw-ports"
  err "[esp32-port] Then re-select explicitly:"
  err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
  exit 1
fi

err "[esp32-port] no port selected for this repo (.esp32-port missing)."
err "[esp32-port] Run: just fw-ports"
err "[esp32-port] Then select explicitly:"
err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
exit 1
