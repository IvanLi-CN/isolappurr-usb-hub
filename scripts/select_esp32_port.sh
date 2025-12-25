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

# espflash list-ports may print leading spaces before /dev/...; allow optional whitespace.
PORT_LIST=$(espflash list-ports 2>/dev/null | awk '/^[[:space:]]*\/dev\// {print $1}')
if [ -z "$PORT_LIST" ]; then
  err "[esp32-port] no ESP32 serial ports detected."
  err "[esp32-port] Run: just fw-ports"
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

if [ -z "${PORT:-}" ]; then
  err "[esp32-port] PORT is required to select a flash port."
  err "[esp32-port] Run: just fw-ports"
  err "[esp32-port] Then select explicitly:"
  err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
  exit 2
fi

if ! contains_port "$PORT" "${ALL_PORTS[@]}"; then
  err "[esp32-port] PORT=$PORT is not available; valid ports: ${ALL_PORTS[*]}"
  err "[esp32-port] Run: just fw-ports"
  exit 1
fi

echo "$PORT" >"$CACHE_FILE"
echo "$PORT"

