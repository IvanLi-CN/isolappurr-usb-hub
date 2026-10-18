#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd)
SW2303_REPO="https://github.com/IvanLi-CN/sw2303-rs.git"
# Published sw2303 0.0.2 (release/0.0.2); firmware uses the crates.io package.
SW2303_REV="12268070f94e1d6ba82fe834261ec696766e900e"
TARGET_DIR="$ROOT_DIR/target/sw2303-host-tests/target"

HOST_TMP_ROOT="${TMPDIR:-/tmp}"
mkdir -p "$HOST_TMP_ROOT"
HOST_TMP_ROOT=$(CDPATH= cd -P -- "$HOST_TMP_ROOT" && pwd)
case "$HOST_TMP_ROOT/" in
  "$ROOT_DIR/"*)
    HOST_TMP_ROOT="/tmp"
    mkdir -p "$HOST_TMP_ROOT"
    HOST_TMP_ROOT=$(CDPATH= cd -P -- "$HOST_TMP_ROOT" && pwd)
    ;;
esac

CACHE_DIR="$HOST_TMP_ROOT/isolapurr-usb-hub-sw2303-host-tests"
mkdir -p "$CACHE_DIR"
CACHE_DIR=$(CDPATH= cd -P -- "$CACHE_DIR" && pwd)
case "$CACHE_DIR/" in
  "$ROOT_DIR/"*)
    echo "error: SW2303 host-test cache must be outside the repository workspace" >&2
    exit 2
    ;;
esac

WORK_DIR="$CACHE_DIR/repo"

if [ -L "$WORK_DIR" ]; then
  echo "error: SW2303 host-test checkout must not be a symlink" >&2
  exit 2
fi

HOST_TARGET=$(rustc +stable -vV | sed -n 's/^host: //p')
if [ -z "$HOST_TARGET" ]; then
  echo "error: failed to detect rust host target from stable toolchain" >&2
  exit 2
fi

mkdir -p "$(dirname "$WORK_DIR")"
if [ -d "$WORK_DIR/.git" ]; then
  git -C "$WORK_DIR" fetch --prune origin
else
  git clone "$SW2303_REPO" "$WORK_DIR"
fi
git -C "$WORK_DIR" checkout --detach "$SW2303_REV"

exec cargo +stable test \
  --manifest-path "$WORK_DIR/Cargo.toml" \
  --tests \
  --target "$HOST_TARGET" \
  --target-dir "$TARGET_DIR" \
  --config 'unstable.build-std=[]'
