#!/usr/bin/env bash
# shellcheck disable=SC2329
set -u -o pipefail

mode="automatic"
case "${1:-}" in
  --automatic)
    mode="automatic"
    ;;
  --strict)
    mode="strict"
    ;;
  "")
    ;;
  *)
    printf 'usage: %s [--automatic|--strict]\n' "$0" >&2
    exit 2
    ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  printf '%s\n' "worktree bootstrap: not inside a Git worktree" >&2
  [[ "$mode" == "automatic" ]] && exit 0
  exit 2
fi
cd "$ROOT" || exit 2

BUN_BIN="${BUN_BIN:-bun}"
CARGO_BIN="${CARGO_BIN:-cargo}"
export BUN_BIN CARGO_BIN ROOT

manifest_files=(
  package.json
  bun.lock
  web/package.json
  web/bun.lock
  Cargo.toml
  Cargo.lock
  tools/isolapurr-host/Cargo.toml
  tools/isolapurr-host/Cargo.lock
  desktop/src-tauri/Cargo.toml
  desktop/src-tauri/Cargo.lock
)

failures=()
record_failure() {
  failures+=("$1")
  printf 'worktree bootstrap: %s\n' "$1" >&2
}

finish_failures() {
  local status="${1:-${#failures[@]}}"
  if [[ "$mode" == "automatic" ]]; then
    printf 'warning: automatic bootstrap completed with %d warning(s); run just worktree-bootstrap for strict repair\n' "${#failures[@]}" >&2
    exit 0
  fi
  printf 'worktree bootstrap: %d step(s) failed\n' "${#failures[@]}" >&2
  exit "$status"
}

for manifest in "${manifest_files[@]}"; do
  if [[ ! -f "$manifest" ]]; then
    record_failure "required lockfile or manifest is missing: $manifest"
  fi
done
if (( ${#failures[@]} > 0 )); then
  finish_failures
fi

hash_text() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256
  else
    sha256sum
  fi
}

if ! manifest_digest="$({
  for manifest in "${manifest_files[@]}"; do
    printf '%s ' "$manifest"
    git hash-object "$manifest"
  done
} | hash_text | awk '{print $1}')"; then
  record_failure "could not calculate manifest digest"
  finish_failures 2
fi
if [[ ! "$manifest_digest" =~ ^[[:xdigit:]]{64}$ ]]; then
  record_failure "manifest digest is invalid"
  finish_failures 2
fi

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
if [[ -z "$git_dir" ]]; then
  record_failure "Git metadata directory could not be resolved"
  finish_failures 2
fi
git_dir="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"
if [[ -z "$git_dir" ]]; then
  record_failure "Git metadata directory is not accessible"
  finish_failures 2
fi

marker_dir="$git_dir/isolapurr-worktree-bootstrap"
marker="$marker_dir/$manifest_digest"

mkdir -p "$marker_dir" || {
  record_failure "could not create Git metadata directory"
  finish_failures 2
}

lock_dir="$marker_dir/.lock"
lock_acquired=0
release_lock() {
  if (( lock_acquired == 1 )); then
    rm -rf "$lock_dir"
  fi
}

acquire_lock() {
  local attempt lock_pid
  for ((attempt = 1; attempt <= 120; attempt++)); do
    if mkdir "$lock_dir" 2>/dev/null; then
      printf '%s\n' "$$" > "$lock_dir/pid"
      lock_acquired=1
      return 0
    fi
    lock_pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
    if [[ -z "$lock_pid" ]]; then
      if (( attempt > 4 )); then
        rm -rf "$lock_dir"
        continue
      fi
      sleep 0.25
      continue
    fi
    if [[ ! "$lock_pid" =~ ^[0-9]+$ ]]; then
      rm -rf "$lock_dir"
      continue
    fi
    if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
      rm -rf "$lock_dir"
      continue
    fi
    sleep 0.25
  done
  return 1
}

if ! acquire_lock; then
  record_failure "timed out waiting for another bootstrap run"
  finish_failures 75
fi
trap release_lock EXIT

cargo_cache_ready() {
  local manifest
  for manifest in Cargo.toml tools/isolapurr-host/Cargo.toml desktop/src-tauri/Cargo.toml; do
    "$CARGO_BIN" metadata --locked --offline --format-version 1 --manifest-path "$manifest" >/dev/null 2>&1 || return 1
  done
}

if [[ -f "$marker" \
  && -d "$ROOT/node_modules/.bin" \
  && -d "$ROOT/web/node_modules/.bin" ]] \
  && cargo_cache_ready; then
  printf 'worktree bootstrap: manifest %s is already ready\n' "$manifest_digest"
  exit 0
fi

run_root_bun() {
  "$BUN_BIN" install --frozen-lockfile
}

run_web_bun() {
  (cd "$ROOT/web" && "$BUN_BIN" install --frozen-lockfile)
}

run_firmware_cargo() {
  "$CARGO_BIN" fetch --locked --manifest-path Cargo.toml
}

run_host_tools_cargo() {
  "$CARGO_BIN" fetch --locked --manifest-path tools/isolapurr-host/Cargo.toml
}

run_desktop_cargo() {
  "$CARGO_BIN" fetch --locked --manifest-path desktop/src-tauri/Cargo.toml
}

run_step() {
  local label="$1"
  shift
  if "$@"; then
    printf 'worktree bootstrap: %s ready\n' "$label"
  else
    local status=$?
    record_failure "$label failed with status $status"
  fi
}

run_step "root Bun dependencies" run_root_bun
run_step "Web Bun dependencies" run_web_bun
run_step "firmware Cargo cache" run_firmware_cargo
run_step "host-tools Cargo cache" run_host_tools_cargo
run_step "desktop Cargo cache" run_desktop_cargo

if (( ${#failures[@]} == 0 )); then
  mkdir -p "$marker_dir"
  marker_tmp="$marker_dir/.${manifest_digest}.tmp.$$"
  if printf '%s\n' "$manifest_digest" > "$marker_tmp" && mv "$marker_tmp" "$marker"; then
    printf 'worktree bootstrap: recorded manifest %s\n' "$manifest_digest"
  else
    rm -f "$marker_tmp"
    record_failure "could not write readiness marker"
  fi
fi

if (( ${#failures[@]} > 0 )); then
  finish_failures
fi

exit 0
