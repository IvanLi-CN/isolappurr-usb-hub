#!/usr/bin/env bash
set -u

hook_name="${1:-}"
previous_head="${2:-}"
new_head="${3:-}"
checkout_type="${4:-0}"

if [[ "$hook_name" != "post-checkout" ]]; then
  exit 0
fi

if [[ "$checkout_type" != "1" ]]; then
  exit 0
fi

if [[ ! -f scripts/worktree-bootstrap.sh ]]; then
  printf '%s\n' "warning: worktree bootstrap is unavailable in this revision; skipping" >&2
  exit 0
fi

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -z "$git_dir" || -z "$common_dir" ]]; then
  printf '%s\n' "warning: Git layout could not be resolved; skipping worktree bootstrap" >&2
  exit 0
fi

git_dir="$(cd "$git_dir" 2>/dev/null && pwd -P || true)"
common_dir="$(cd "$common_dir" 2>/dev/null && pwd -P || true)"
if [[ -z "$git_dir" || -z "$common_dir" || "$git_dir" == "$common_dir" ]]; then
  exit 0
fi

if ! bash scripts/worktree-bootstrap.sh --automatic; then
  printf 'warning: automatic linked worktree bootstrap failed for %s -> %s; run just worktree-bootstrap\n' "$previous_head" "$new_head" >&2
fi

exit 0
