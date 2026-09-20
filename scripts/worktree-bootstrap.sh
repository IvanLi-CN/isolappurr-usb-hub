#!/usr/bin/env bash
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

for manifest in "${manifest_files[@]}"; do
  if [[ ! -f "$manifest" ]]; then
    record_failure "required lockfile or manifest is missing: $manifest"
  fi
done
if (( ${#failures[@]} > 0 )); then
  [[ "$mode" == "automatic" ]] && exit 0
  exit "${#failures[@]}"
fi

hash_text() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256
  else
    sha256sum
  fi
}

manifest_digest="$({
  for manifest in "${manifest_files[@]}"; do
    printf '%s ' "$manifest"
    git hash-object "$manifest"
  done
} | hash_text | awk '{print $1}')"

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
if [[ -z "$git_dir" ]]; then
  record_failure "Git metadata directory could not be resolved"
  [[ "$mode" == "automatic" ]] && exit 0
  exit 2
fi
git_dir="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"
if [[ -z "$git_dir" ]]; then
  record_failure "Git metadata directory is not accessible"
  [[ "$mode" == "automatic" ]] && exit 0
  exit 2
fi

marker_dir="$git_dir/isolapurr-worktree-bootstrap"
marker="$marker_dir/$manifest_digest"
if [[ -f "$marker" && -d "$ROOT/node_modules" && -d "$ROOT/web/node_modules" ]]; then
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
  if [[ "$mode" == "automatic" ]]; then
    printf 'warning: automatic bootstrap completed with %d warning(s); run just worktree-bootstrap for strict repair\n' "${#failures[@]}" >&2
    exit 0
  fi
  printf 'worktree bootstrap: %d step(s) failed\n' "${#failures[@]}" >&2
  exit "${#failures[@]}"
fi

exit 0
