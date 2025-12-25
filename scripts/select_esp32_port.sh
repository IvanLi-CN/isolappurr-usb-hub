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

# List only ports likely to be ESP dev boards (espflash default) and keep output script-friendly.
PORT_LIST=$(espflash list-ports --name-only --skip-update-check 2>/dev/null)
if [ -z "$PORT_LIST" ]; then
  err "[esp32-port] no ESP32 serial ports detected."
  err "[esp32-port] Run: just fw-ports"
  exit 1
fi

ALL_PORTS=()
while IFS= read -r line; do
  [ -n "$line" ] && ALL_PORTS+=("$line")
done <<<"$PORT_LIST"

MENU_PORTS=()
for port in "${ALL_PORTS[@]}"; do
  case "$port" in
    /dev/cu.*) MENU_PORTS+=("$port") ;;
  esac
done
if [ "${#MENU_PORTS[@]}" -eq 0 ]; then
  MENU_PORTS=("${ALL_PORTS[@]}")
fi

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
  # Interactive selection is only allowed when we have a TTY.
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    err "[esp32-port] PORT is required to select a flash port in non-interactive mode."
    err "[esp32-port] Run: just fw-ports"
    err "[esp32-port] Then select explicitly:"
    err "[esp32-port]   PORT=/dev/cu.xxx just fw-select-port"
    exit 2
  fi

  cached=""
  if [ -f "$CACHE_FILE" ]; then
    cached=$(cat "$CACHE_FILE" 2>/dev/null || true)
  fi

  err "[esp32-port] available ESP serial ports:"
  i=1
  for p in "${MENU_PORTS[@]}"; do
    marker=""
    if [ -n "$cached" ] && [ "$p" = "$cached" ]; then
      marker=" (current)"
    fi
    err "  [$i] $p$marker"
    i=$((i + 1))
  done
  err "  [0] Cancel"

  while true; do
    printf '%s' "[esp32-port] enter number: " >&2
    IFS= read -r choice || exit 1
    case "$choice" in
      0)
        err "[esp32-port] canceled."
        exit 1
        ;;
      ''|*[!0-9]*)
        err "[esp32-port] invalid selection; enter a number."
        ;;
      *)
        idx=$((choice))
        if [ "$idx" -ge 1 ] && [ "$idx" -le "${#MENU_PORTS[@]}" ]; then
          PORT="${MENU_PORTS[$((idx - 1))]}"
          break
        fi
        err "[esp32-port] invalid selection; choose 1..${#MENU_PORTS[@]} or 0."
        ;;
    esac
  done
fi

if ! contains_port "$PORT" "${ALL_PORTS[@]}"; then
  err "[esp32-port] PORT=$PORT is not available; valid ports: ${ALL_PORTS[*]}"
  err "[esp32-port] Run: just fw-ports"
  exit 1
fi

echo "$PORT" >"$CACHE_FILE"
echo "$PORT"
