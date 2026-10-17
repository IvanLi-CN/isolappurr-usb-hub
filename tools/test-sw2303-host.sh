#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SW2303_REPO="https://github.com/IvanLi-CN/sw2303-rs.git"
SW2303_REV="0bd533359cd033396ea18c67d0a79c41f1a89584"
WORK_DIR="${TMPDIR:-/tmp}/isolapurr-usb-hub-sw2303-host-tests/repo"
TARGET_DIR="$ROOT_DIR/target/sw2303-host-tests/target"

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
