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
  err "[esp32-port] no ESP32 serial ports detected; plug in the board or set PORT=/dev/... explicitly."
  exit 1
fi

ALL_PORTS=()
while IFS= read -r line; do
  [ -n "$line" ] && ALL_PORTS+=("$line")
done <<<"$PORT_LIST"

CU_LIST=$(printf '%s\n' "${ALL_PORTS[@]}" 2>/dev/null | grep '^/dev/cu\.' || true)
CU_PORTS=()
while IFS= read -r line; do
  [ -n "$line" ] && CU_PORTS+=("$line")
done <<<"$CU_LIST"

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

pick_port() {
  local candidate="$1"
  echo "$candidate" > "$CACHE_FILE"
  echo "$candidate"
}

if [ -n "${PORT:-}" ]; then
  if contains_port "$PORT" "${ALL_PORTS[@]}"; then
    pick_port "$PORT"
    exit 0
  fi
  err "[esp32-port] PORT=$PORT is not available; valid ports: ${ALL_PORTS[*]}"
  exit 1
fi

if [ "${#CU_PORTS[@]}" -eq 1 ]; then
  pick_port "${CU_PORTS[0]}"
  exit 0
fi

if [ "${#ALL_PORTS[@]}" -eq 1 ]; then
  pick_port "${ALL_PORTS[0]}"
  exit 0
fi

if [ -f "$CACHE_FILE" ]; then
  cached=$(cat "$CACHE_FILE" 2>/dev/null || true)
  if [ -n "$cached" ] && contains_port "$cached" "${ALL_PORTS[@]}"; then
    echo "$cached"
    exit 0
  fi
fi

# Interactive selection when multiple ports are present and we are in a TTY.
if [ -t 0 ] && [ -t 1 ]; then
  err "[esp32-port] multiple serial ports detected: ${ALL_PORTS[*]}"
  err "[esp32-port] pick one (or Ctrl+C to cancel):"
  PS3="[esp32-port] enter number: "
  select choice in "${ALL_PORTS[@]}" "Cancel"; do
    case "$choice" in
      "Cancel"|"")
        err "[esp32-port] canceled. Use 'PORT=/dev/cu.xxx just fw-select-port' or write .esp32-port manually."
        exit 1 ;;
      *)
        if contains_port "$choice" "${ALL_PORTS[@]}"; then
          pick_port "$choice"
          exit 0
        fi
        err "[esp32-port] invalid selection, try again." ;;
    esac
  done
fi

err "[esp32-port] multiple serial ports detected: ${ALL_PORTS[*]}"
err "[esp32-port] run 'PORT=/dev/cu.xxx just fw-select-port' (or write .esp32-port) to choose."
exit 1
