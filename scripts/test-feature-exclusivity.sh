#!/bin/sh
set -eu

expect_failure() {
    if cargo check --no-default-features --features "$1" >/tmp/isolapurr-feature-check.log 2>&1; then
        echo "expected profile selection '$1' to fail" >&2
        cat /tmp/isolapurr-feature-check.log >&2
        exit 1
    fi
}

expect_failure "net_http"
expect_failure "net_http,board_tps_sw,board_tps_fusb"
echo "board profile feature exclusivity: ok"
