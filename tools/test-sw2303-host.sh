#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
HOST_TARGET=$(rustc +stable -vV | sed -n 's/^host: //p')
if [ -z "$HOST_TARGET" ]; then
  echo "error: failed to detect rust host target from stable toolchain" >&2
  exit 2
fi

cd "$ROOT_DIR"
exec cargo +stable test   --manifest-path vendor/sw2303-rs/Cargo.toml   --tests   --target "$HOST_TARGET"   --target-dir target/sw2303-host-tests   --config 'unstable.build-std=[]'
