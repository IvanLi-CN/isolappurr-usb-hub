#!/usr/bin/env bash
set -u -o pipefail

repo_root="$(git rev-parse --show-toplevel)"
command -v lefthook >/dev/null 2>&1 || {
  printf '%s\n' "worktree bootstrap smoke requires lefthook on PATH" >&2
  exit 2
}

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/isolapurr-worktree-bootstrap.XXXXXX")"
fixture="$tmp_root/fixture"
linked="$tmp_root/linked"
fake_bin="$tmp_root/fake-bin"
log_file="$tmp_root/tool-calls.log"
mkdir -p "$fixture" "$fake_bin"

cleanup() {
  git -C "$fixture" worktree remove --force "$linked" >/dev/null 2>&1 || true
  rm -rf "$tmp_root"
}
trap cleanup EXIT

failures=0
fail() {
  printf 'worktree bootstrap smoke: %s\n' "$1" >&2
  failures=$((failures + 1))
}

assert_equal() {
  [[ "$1" == "$2" ]] || fail "$3"
}

git init -q -b main "$fixture"
git -C "$fixture" config user.name "Worktree Bootstrap Smoke"
git -C "$fixture" config user.email "worktree-bootstrap@example.invalid"
printf '%s\n' historical > "$fixture/historical.txt"
git -C "$fixture" add historical.txt
git -C "$fixture" commit -qm "test: create historical fixture"

mkdir -p "$fixture/scripts" "$fixture/web" "$fixture/tools/isolapurr-host" "$fixture/desktop/src-tauri"
cp "$repo_root/lefthook.yml" "$fixture/lefthook.yml"
cp "$repo_root/scripts/run-lefthook-hook.sh" "$fixture/scripts/run-lefthook-hook.sh"
cp "$repo_root/scripts/worktree-bootstrap.sh" "$fixture/scripts/worktree-bootstrap.sh"
cp "$repo_root/package.json" "$fixture/package.json"
cp "$repo_root/bun.lock" "$fixture/bun.lock"
cp "$repo_root/web/package.json" "$fixture/web/package.json"
cp "$repo_root/web/bun.lock" "$fixture/web/bun.lock"
cp "$repo_root/Cargo.toml" "$fixture/Cargo.toml"
cp "$repo_root/Cargo.lock" "$fixture/Cargo.lock"
cp "$repo_root/tools/isolapurr-host/Cargo.toml" "$fixture/tools/isolapurr-host/Cargo.toml"
cp "$repo_root/tools/isolapurr-host/Cargo.lock" "$fixture/tools/isolapurr-host/Cargo.lock"
cp "$repo_root/desktop/src-tauri/Cargo.toml" "$fixture/desktop/src-tauri/Cargo.toml"
cp "$repo_root/desktop/src-tauri/Cargo.lock" "$fixture/desktop/src-tauri/Cargo.lock"
git -C "$fixture" add .
git -C "$fixture" commit -qm "test: add bootstrap fixture"
current_commit="$(git -C "$fixture" rev-parse HEAD)"

fake_tool="$tmp_root/fake-tool"
# shellcheck disable=SC2016
printf '%s\n' '#!/usr/bin/env bash' 'set -u' 'tool="${0##*/}"' 'printf "%s\\t%s\\t%s\\n" "$tool" "$PWD" "$*" >> "$BOOTSTRAP_LOG"' 'if [[ "${SLEEP_MODE:-0}" == "1" ]]; then sleep 0.2; fi' 'if [[ "${FAIL_MODE:-0}" == "1" ]]; then exit 23; fi' 'if [[ "$tool" == "bun" ]]; then mkdir -p "$PWD/node_modules/.bin"; fi' 'exit 0' > "$fake_tool"
chmod +x "$fake_tool"
ln -s "$fake_tool" "$fake_bin/bun"
ln -s "$fake_tool" "$fake_bin/cargo"
: > "$log_file"
export BOOTSTRAP_LOG="$log_file"
export BUN_BIN="$fake_bin/bun"
export CARGO_BIN="$fake_bin/cargo"

(cd "$fixture" && lefthook install >/dev/null)
git -C "$fixture" worktree add --detach "$linked" "$current_commit" >/dev/null

call_count="$(wc -l < "$log_file" | tr -d ' ')"
assert_equal "$call_count" "5" "first linked checkout did not run all five dependency steps"
fetch_count="$(grep -c $'\tfetch ' "$log_file" || true)"
install_count="$(grep -c $'\tinstall ' "$log_file" || true)"
assert_equal "$fetch_count" "3" "first linked checkout did not run all Cargo fetch steps"
assert_equal "$install_count" "2" "first linked checkout did not run both Bun install steps"
linked_git_dir="$(git -C "$linked" rev-parse --git-dir)"
marker_count="$(find "$linked_git_dir/isolapurr-worktree-bootstrap" -maxdepth 1 -type f -print 2>/dev/null | wc -l | tr -d ' ')"
[[ "$marker_count" == "1" ]] || fail "first linked checkout did not create one readiness marker"

before_repeat="$call_count"
git -C "$linked" switch -c repeat >/dev/null
after_repeat="$(wc -l < "$log_file" | tr -d ' ')"
repeat_fetch_count="$(grep -c $'\tfetch ' "$log_file" || true)"
repeat_install_count="$(grep -c $'\tinstall ' "$log_file" || true)"
assert_equal "$repeat_fetch_count" "$fetch_count" "repeat checkout reran Cargo fetch"
assert_equal "$repeat_install_count" "$install_count" "repeat checkout reran Bun install"
[[ "$after_repeat" -gt "$before_repeat" ]] || fail "repeat checkout did not verify cached Cargo metadata"

historical_commit="$(git -C "$fixture" rev-list --max-parents=0 HEAD)"
git -C "$linked" checkout "$historical_commit" >/dev/null
after_historical_fetch="$(grep -c $'\tfetch ' "$log_file" || true)"
assert_equal "$after_historical_fetch" "$fetch_count" "historical revision executed bootstrap steps"
git -C "$linked" checkout "$current_commit" >/dev/null

rm -rf "$linked/node_modules" "$linked/web/node_modules"
find "$linked_git_dir/isolapurr-worktree-bootstrap" -type f -delete
export SLEEP_MODE=1
(cd "$linked" && bash scripts/worktree-bootstrap.sh --strict > "$tmp_root/concurrent-1.out" 2>&1; printf '%s\n' "$?" > "$tmp_root/concurrent-1.rc") &
first_pid=$!
(cd "$linked" && bash scripts/worktree-bootstrap.sh --strict > "$tmp_root/concurrent-2.out" 2>&1; printf '%s\n' "$?" > "$tmp_root/concurrent-2.rc") &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
unset SLEEP_MODE
[[ "$(< "$tmp_root/concurrent-1.rc")" == "0" ]] || fail "first concurrent bootstrap failed"
[[ "$(< "$tmp_root/concurrent-2.rc")" == "0" ]] || fail "second concurrent bootstrap failed"
concurrent_fetch_count="$(grep -c $'\tfetch ' "$log_file" || true)"
concurrent_install_count="$(grep -c $'\tinstall ' "$log_file" || true)"
assert_equal "$concurrent_fetch_count" "$((fetch_count + 3))" "concurrent bootstrap duplicated Cargo fetch"
assert_equal "$concurrent_install_count" "$((install_count + 2))" "concurrent bootstrap duplicated Bun install"

mv "$linked/web/bun.lock" "$linked/web/bun.lock.missing"
early_output="$(cd "$linked" && bash scripts/worktree-bootstrap.sh --automatic 2>&1)"
early_status=$?
assert_equal "$early_status" "0" "automatic missing-manifest failure did not return success"
[[ "$early_output" == *"warning"* ]] || fail "automatic missing-manifest failure did not print a warning"
mv "$linked/web/bun.lock.missing" "$linked/web/bun.lock"

printf '%s\n' local-env > "$linked/.env"
printf '%s\n' local-port > "$linked/.esp32-port"
cp "$linked/.env" "$tmp_root/env.before"
cp "$linked/.esp32-port" "$tmp_root/port.before"
rm -rf "$linked/node_modules" "$linked/web/node_modules"
find "$linked_git_dir/isolapurr-worktree-bootstrap" -type f -delete
export FAIL_MODE=1
auto_output="$(cd "$linked" && bash scripts/worktree-bootstrap.sh --automatic 2>&1)"
auto_status=$?
assert_equal "$auto_status" "0" "automatic failure did not return success"
[[ "$auto_output" == *"warning"* ]] || fail "automatic failure did not print a warning"
strict_output="$(cd "$linked" && bash scripts/worktree-bootstrap.sh --strict 2>&1)"
strict_status=$?
[[ "$strict_status" != "0" ]] || fail "strict failure returned success"
[[ "$strict_output" == *"5 step(s) failed"* ]] || fail "strict failure did not aggregate all steps"
cmp -s "$linked/.env" "$tmp_root/env.before" || fail "bootstrap changed .env"
cmp -s "$linked/.esp32-port" "$tmp_root/port.before" || fail "bootstrap changed .esp32-port"
unset FAIL_MODE

custom_hooks="$tmp_root/custom-hooks"
mkdir -p "$custom_hooks"
printf '%s\n' unmanaged > "$custom_hooks/post-checkout"
git -C "$fixture" config core.hooksPath "$custom_hooks"
(cd "$fixture" && lefthook install >/dev/null 2>&1) || true
[[ "$(< "$custom_hooks/post-checkout")" == "unmanaged" ]] || fail "custom hooks path was overwritten"

before_main="$(wc -l < "$log_file" | tr -d ' ')"
export FAIL_MODE=1
(cd "$fixture" && bash scripts/run-lefthook-hook.sh post-checkout old new 1 >/dev/null 2>&1)
after_main="$(wc -l < "$log_file" | tr -d ' ')"
assert_equal "$after_main" "$before_main" "main worktree automatic hook did not skip"

if (( failures > 0 )); then
  printf 'worktree bootstrap smoke: %d assertion(s) failed\n' "$failures" >&2
  exit 1
fi
printf '%s\n' "worktree bootstrap smoke: passed"
