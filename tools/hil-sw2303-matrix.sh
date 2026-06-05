#!/usr/bin/env bash
set -u

usage() {
  cat <<'USAGE'
Run SW2303 protocol-control HIL against an IsolaPurr source and LoadLynx sink.

This script only automates the PD/PPS parts that LoadLynx can validate as a
sink. Non-PD protocols (QC/FCP/AFC/SCP/PE/SFCP/BC1.2) require matching external
sinks and are printed as manual coverage.

Environment:
  ISOLAPURR_URL        default: http://192.168.31.122
  LOADLYNX_HARDWARE   default: loadlynx-d68638
  LOADLYNX_WORKDIR    default: $HOME
  HIL_OWNER           default: 991230
  WAIT_APPLY_TIMEOUT_SEC default: 8
  HIL_USE_LOCK        default: 1; acquire and refresh the power-config host lock
  HIL_RESTORE_CONFIG  default: 1; restore the starting IsolaPurr power config on exit

Modes:
  --smoke             defaults + fixed 12V + PPS 11V + restore 12V
  --pd               PD fixed/PPS capability matrix (default)
  --prune            fixed PDO mask, PPS disable, restore, and 22V negative
  --power            power-cap matrix; use with --with-load for load checks
  --manual-non-pd    print required non-PD sink matrix and exit

Options:
  --with-load         enable LoadLynx electronic load during positive cases
  --load-percent N   load at N percent of negotiated/requested current (default: 20)
  --settle-sec N     delay after config/PD changes (default: 3)
  --help             show this help
USAGE
}

MODE=pd
WITH_LOAD=0
LOAD_PERCENT=20
SETTLE_SEC=3
ISOLAPURR_URL="${ISOLAPURR_URL:-http://192.168.31.122}"
LOADLYNX_HARDWARE="${LOADLYNX_HARDWARE:-loadlynx-d68638}"
LOADLYNX_WORKDIR="${LOADLYNX_WORKDIR:-$HOME}"
HIL_OWNER="${HIL_OWNER:-991230}"
WAIT_APPLY_TIMEOUT_SEC="${WAIT_APPLY_TIMEOUT_SEC:-8}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --smoke) MODE=smoke ;;
    --pd) MODE=pd ;;
    --prune) MODE=prune ;;
    --power) MODE=power ;;
    --manual-non-pd) MODE=manual-non-pd ;;
    --with-load) WITH_LOAD=1 ;;
    --load-percent)
      shift
      LOAD_PERCENT="${1:?missing --load-percent value}"
      ;;
    --settle-sec)
      shift
      SETTLE_SEC="${1:?missing --settle-sec value}"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing required command: $1" >&2
    exit 2
  }
}

require_cmd curl
require_cmd jq
require_cmd loadlynx

PASS=0
FAIL=0
SKIP=0
ORIGINAL_CONFIG=""
RESTORE_POWER_CONFIG="${HIL_RESTORE_CONFIG:-1}"
USE_HIL_LOCK="${HIL_USE_LOCK:-1}"
LOCK_ACQUIRED=0
LOCK_HEARTBEAT_PID=""

cleanup() {
  if [ "${WITH_LOAD}" = "1" ]; then
    ll output set --hardware "$LOADLYNX_HARDWARE" --disable --json >/dev/null 2>&1 || true
  fi
  restore_original_config
  stop_lock_heartbeat
  release_hil_lock
}
trap cleanup EXIT

ll() {
  (cd "$LOADLYNX_WORKDIR" && loadlynx "$@")
}

require_loadlynx_usb_pd_control() {
  case "$MODE" in
    smoke|pd|prune|power) ;;
    *) return 0 ;;
  esac

  hardware_json="$(ll hardware list --json)" || {
    echo "error: failed to read LoadLynx hardware memory" >&2
    exit 2
  }
  transport="$(echo "$hardware_json" | jq -r --arg id "$LOADLYNX_HARDWARE" '
    (.hardware[]? | select(.id == $id) | .last_transport) // empty
  ')"
  if [ -z "$transport" ]; then
    echo "error: LoadLynx hardware '${LOADLYNX_HARDWARE}' is not saved" >&2
    exit 2
  fi
  if [ "$transport" != "usb" ]; then
    echo "error: LoadLynx hardware '${LOADLYNX_HARDWARE}' uses transport '${transport}', but pd set requires USB/devd hardware" >&2
    echo "hint: connect the LoadLynx USB control cable, then run: loadlynx hardware use ${LOADLYNX_HARDWARE} --transport usb" >&2
    exit 2
  fi
  if ! ll status --hardware "$LOADLYNX_HARDWARE" --json >/dev/null; then
    echo "error: LoadLynx hardware '${LOADLYNX_HARDWARE}' is not reachable over USB/devd" >&2
    exit 2
  fi
}

note() {
  printf '\n== %s ==\n' "$1"
}

pass() {
  PASS=$((PASS + 1))
  printf 'PASS %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf 'FAIL %s: %s\n' "$1" "$2" >&2
}

skip() {
  SKIP=$((SKIP + 1))
  printf 'SKIP %s: %s\n' "$1" "$2"
}

http_json() {
  method="$1"
  path="$2"
  body="${3:-}"
  attempt=1
  while [ "$attempt" -le 3 ]; do
    if [ -n "$body" ]; then
      out="$(curl -sS --max-time 20 -X "$method" \
        -H 'Content-Type: application/json' \
        --data "$body" \
        "${ISOLAPURR_URL}${path}" 2>&1)"
    else
      out="$(curl -sS --max-time 20 -X "$method" "${ISOLAPURR_URL}${path}" 2>&1)"
    fi
    rc=$?
    if [ "$rc" -eq 0 ] && printf '%s' "$out" | jq -e . >/dev/null 2>&1; then
      printf '%s\n' "$out"
      return 0
    fi
    printf 'WARN http_json attempt=%s method=%s path=%s rc=%s output=%s\n' \
      "$attempt" "$method" "$path" "$rc" "$out" >&2
    sleep "$attempt"
    attempt=$((attempt + 1))
  done
  return 1
}

make_config() {
  power_watts="$1"
  pd="$2"
  qc20="$3"
  qc30="$4"
  fcp="$5"
  afc="$6"
  scp="$7"
  pe20="$8"
  bc12="$9"
  sfcp="${10}"
  pps="${11}"
  fixed_csv="${12}"

  fixed_json="$(jq -nc --arg fixed_csv "$fixed_csv" \
    '$fixed_csv | if length == 0 then [] else split(",") | map(tonumber) end')"
  jq -nc \
    --argjson power "$power_watts" \
    --argjson pd "$pd" \
    --argjson qc20 "$qc20" \
    --argjson qc30 "$qc30" \
    --argjson fcp "$fcp" \
    --argjson afc "$afc" \
    --argjson scp "$scp" \
    --argjson pe20 "$pe20" \
    --argjson bc12 "$bc12" \
    --argjson sfcp "$sfcp" \
    --argjson pps "$pps" \
    --argjson fixed "$fixed_json" \
    '{
      hardware:"sw2303",
      tps_mode:"auto_follow",
      capability:{
        profile:"full",
        power_watts:$power,
        protocols:{
          pd:$pd,qc20:$qc20,qc30:$qc30,fcp:$fcp,afc:$afc,scp:$scp,
          pe20:$pe20,bc12:$bc12,sfcp:$sfcp
        },
        pd:{pps:$pps,fixed_voltages_mv:$fixed}
      },
      manual:{voltage_mv:5000,current_limit_ma:1000,usb_c_path_mode:"default"}
    }'
}

set_config() {
  label="$1"
  body="$2"
  note "CONFIG $label"
  refresh_hil_lock || {
    fail "$label" "failed to refresh HIL host lock"
    return 1
  }
  out="$(http_json PUT "/api/v1/power/config?owner=${HIL_OWNER}" "$body")"
  echo "$out" | jq -e -c 'if .error then error(.error.message) else {persisted,tps_mode,power_watts:.capability.power_watts,protocols:.capability.protocols,pps:.capability.pd.pps,fixed:.capability.pd.fixed_voltages_mv,lock} end' || {
    fail "$label" "config response was an error or not JSON"
    return 1
  }
  wait_sw2303_apply "$label" "$out" || return 1
  sleep "$SETTLE_SEC"
}

defaults() {
  note "CONFIG defaults"
  refresh_hil_lock || {
    fail "defaults" "failed to refresh HIL host lock"
    return 1
  }
  out="$(http_json POST "/api/v1/power/config/defaults?owner=${HIL_OWNER}")"
  echo "$out" | jq -e -c 'if .error then error(.error.message) else {persisted,tps_mode,power_watts:.capability.power_watts,protocols:.capability.protocols,pps:.capability.pd.pps,fixed:.capability.pd.fixed_voltages_mv,lock} end' || {
    fail "defaults" "defaults response was an error or not JSON"
    return 1
  }
  wait_sw2303_apply defaults "$out" || return 1
  sleep "$SETTLE_SEC"
}

acquire_hil_lock() {
  if [ "$USE_HIL_LOCK" != "1" ]; then
    return 0
  fi
  note "LOCK acquire"
  out="$(http_json POST "/api/v1/power/config/lock?owner=${HIL_OWNER}")" || {
    echo "error: failed to acquire IsolaPurr power config lock" >&2
    exit 1
  }
  echo "$out" | jq -e 'if .error then error(.error.message) else true end' >/dev/null || {
    echo "error: IsolaPurr power config lock is busy" >&2
    exit 1
  }
  LOCK_ACQUIRED=1
}

start_lock_heartbeat() {
  if [ "$USE_HIL_LOCK" != "1" ] || [ "$LOCK_ACQUIRED" != "1" ]; then
    return 0
  fi
  (
    while true; do
      sleep 3
      http_json POST "/api/v1/power/config/lock?owner=${HIL_OWNER}" >/dev/null 2>&1 || true
    done
  ) &
  LOCK_HEARTBEAT_PID="$!"
}

stop_lock_heartbeat() {
  if [ -z "$LOCK_HEARTBEAT_PID" ]; then
    return 0
  fi
  kill "$LOCK_HEARTBEAT_PID" >/dev/null 2>&1 || true
  wait "$LOCK_HEARTBEAT_PID" 2>/dev/null || true
  LOCK_HEARTBEAT_PID=""
}

refresh_hil_lock() {
  if [ "$USE_HIL_LOCK" != "1" ]; then
    return 0
  fi
  out="$(http_json POST "/api/v1/power/config/lock?owner=${HIL_OWNER}")" || return 1
  echo "$out" | jq -e 'if .error then error(.error.message) else true end' >/dev/null
}

release_hil_lock() {
  if [ "$USE_HIL_LOCK" != "1" ] || [ "$LOCK_ACQUIRED" != "1" ]; then
    return 0
  fi
  printf '\n== LOCK release ==\n' >&2
  http_json POST "/api/v1/power/config/release?owner=${HIL_OWNER}" >/dev/null || true
  LOCK_ACQUIRED=0
}

capture_original_config() {
  if [ "$RESTORE_POWER_CONFIG" != "1" ]; then
    return 0
  fi
  ORIGINAL_CONFIG="$(http_json GET /api/v1/power/config)" || {
    echo "error: failed to capture original IsolaPurr power config" >&2
    exit 1
  }
}

restore_original_config() {
  if [ "$RESTORE_POWER_CONFIG" != "1" ] || [ -z "$ORIGINAL_CONFIG" ]; then
    return 0
  fi
  printf '\n== RESTORE original power config ==\n' >&2
  refresh_hil_lock || true
  if ! http_json PUT "/api/v1/power/config?owner=${HIL_OWNER}" "$ORIGINAL_CONFIG" >/dev/null; then
    echo "WARN failed to restore original IsolaPurr power config" >&2
  fi
  ORIGINAL_CONFIG=""
}

wait_sw2303_apply() {
  label="$1"
  expected="$2"
  deadline=$(( $(date +%s) + WAIT_APPLY_TIMEOUT_SEC ))
  while [ "$(date +%s)" -le "$deadline" ]; do
    out="$(http_json GET /api/v1/pd-diagnostics)" || {
      sleep 1
      continue
    }
    if echo "$out" | jq -e --argjson expected "$expected" '
      .sw2303_profile_applied == true and
      .sw2303_readback_config.matches_config == true and
      .sw2303_readback_config.power_watts == $expected.capability.power_watts and
      .sw2303_readback_config.protocols == $expected.capability.protocols and
      .sw2303_readback_config.pd.pps == $expected.capability.pd.pps and
      .sw2303_readback_config.pd.fixed_voltages_mv == $expected.capability.pd.fixed_voltages_mv
    ' >/dev/null 2>&1; then
      echo "$out" | jq -c '{profile:.sw2303_profile_applied,readback:.sw2303_readback_config}'
      return 0
    fi
    sleep 1
  done

  out="$(http_json GET /api/v1/pd-diagnostics 2>/dev/null || printf '{}')"
  fail "$label" "SW2303 readback did not match config before timeout: $out"
  return 1
}

snapshot_json() {
  iso_cfg="$(http_json GET /api/v1/power/config)" || return 1
  iso_pd="$(http_json GET /api/v1/pd-diagnostics)" || return 1
  iso_ports="$(http_json GET /api/v1/ports)" || return 1
  ll_status="$(ll status --hardware "$LOADLYNX_HARDWARE" --json)" || return 1

  jq -nc \
    --argjson cfg "$iso_cfg" \
    --argjson pd "$iso_pd" \
    --argjson ports "$iso_ports" \
    --argjson ll "$ll_status" \
    '{
      cfg:{
        power_watts:$cfg.capability.power_watts,
        pd:$cfg.capability.protocols.pd,
        pps:$cfg.capability.pd.pps,
        fixed:$cfg.capability.pd.fixed_voltages_mv
      },
      iso_pd:{
        request:$pd.sw2303_request,
        tps:$pd.tps_setpoint,
        profile:$pd.sw2303_profile_applied,
        readback:$pd.sw2303_readback_config,
        sw_latch:$pd.sw2303_error_latched,
        tps_latch:$pd.tps_error_latched
      },
      port_c:($ports.ports[] | select(.portId == "port_c") | {
        v_mv:.telemetry.voltage_mv,
        i_ma:.telemetry.current_ma,
        p_mw:.telemetry.power_mw,
        power:.state.power_enabled,
        busy:.state.busy
      }),
      loadlynx:{
        hello_seen:$ll.hello_seen,
        link_up:$ll.link_up,
        analog_state:$ll.analog_state,
        fault_flags:$ll.status.fault_flags,
        v_local_mv:$ll.status.v_local_mv,
        i_remote_ma:$ll.status.i_remote_ma,
        output_enabled:$ll.control.output_enabled
      }
    }'
}

abs_diff() {
  a="$1"
  b="$2"
  d=$((a - b))
  if [ "$d" -lt 0 ]; then
    d=$((-d))
  fi
  printf '%s' "$d"
}

is_int() {
  case "$1" in
    ''|null) return 1 ;;
    *[!0-9-]*) return 1 ;;
    *) return 0 ;;
  esac
}

advertises_fixed_mv() {
  out="$1"
  mv="$2"
  echo "$out" | jq -e --argjson mv "$mv" '(.fixed_pdos // []) | any(.mv == $mv)' >/dev/null 2>&1
}

advertises_pps_mv() {
  out="$1"
  mv="$2"
  echo "$out" | jq -e --argjson mv "$mv" '(.pps_pdos // []) | any(.min_mv <= $mv and .max_mv >= $mv)' >/dev/null 2>&1
}

check_no_faults() {
  label="$1"
  snap="$2"
  link="$(echo "$snap" | jq -r '.loadlynx.link_up')"
  fault="$(echo "$snap" | jq -r '.loadlynx.fault_flags')"
  sw_latch="$(echo "$snap" | jq -r '.iso_pd.sw_latch')"
  tps_latch="$(echo "$snap" | jq -r '.iso_pd.tps_latch')"
  profile="$(echo "$snap" | jq -r '.iso_pd.profile')"
  if [ "$link" != "true" ] || [ "$fault" != "0" ] || [ "$sw_latch" != "false" ] || [ "$tps_latch" != "false" ] || [ "$profile" != "true" ]; then
    fail "$label" "fault/link/profile check failed: $snap"
    return 1
  fi
  return 0
}

load_check() {
  label="$1"
  contract_ma="$2"
  if [ "$WITH_LOAD" != "1" ]; then
    skip "${label}/load" "run with --with-load to enable electronic load checks"
    return 0
  fi
  target_ma=$((contract_ma * LOAD_PERCENT / 100))
  if [ "$target_ma" -lt 50 ]; then
    target_ma=50
  fi
  note "LOAD $label ${target_ma}mA"
  ll output set --hardware "$LOADLYNX_HARDWARE" --target-i-ma "$target_ma" --enable --json | jq -c '{ok:(.ok // true),control:(.control // .)}' || true
  sleep "$SETTLE_SEC"
  snap="$(snapshot_json)" || {
    fail "${label}/load" "snapshot collection failed"
    return 1
  }
  echo "$snap"
  check_no_faults "${label}/load" "$snap" || return 1
  ll output set --hardware "$LOADLYNX_HARDWARE" --disable --json >/dev/null
  sleep 1
  pass "${label}/load ${target_ma}mA"
}

pd_case() {
  label="$1"
  mode="$2"
  object_pos="$3"
  target_mv="$4"
  i_req_ma="$5"
  expect="$6"
  allow_extended="${7:-true}"
  tolerance="${8:-500}"

  note "PD $label mode=$mode pos=$object_pos target=${target_mv}mV"
  out="$(ll pd set \
    --hardware "$LOADLYNX_HARDWARE" \
    --mode "$mode" \
    --object-pos "$object_pos" \
    --target-mv "$target_mv" \
    --i-req-ma "$i_req_ma" \
    --allow-extended-voltage "$allow_extended" \
    --json 2>&1)"
  rc=$?
  echo "$out" | jq -c --argjson rc "$rc" '{rc:$rc,error:(.error // null),contract_mv:(.contract_mv // null),contract_ma:(.contract_ma // null),fixed_pdos:(.fixed_pdos // null),pps_pdos:(.pps_pdos // null),saved:(.saved // null),apply:(.apply // null)}' 2>/dev/null || printf '%s\n' "$out"
  sleep "$SETTLE_SEC"

  snap="$(snapshot_json)" || {
    fail "$label" "snapshot collection failed"
    return 1
  }
  echo "$snap"

  if [ "$expect" = "reject" ]; then
    if { [ "$mode" = "fixed" ] && advertises_fixed_mv "$out" "$target_mv"; } ||
      { [ "$mode" = "pps" ] && advertises_pps_mv "$out" "$target_mv"; }; then
      fail "$label" "forbidden ${target_mv}mV is still advertised in source capabilities"
      return 1
    fi

    sw_mv="$(echo "$snap" | jq -r '.iso_pd.request.mv')"
    ll_mv="$(echo "$snap" | jq -r '.loadlynx.v_local_mv')"
    if [ "$rc" -ne 0 ] || [ "$sw_mv" != "$target_mv" ] || [ "$ll_mv" != "$target_mv" ]; then
      check_no_faults "$label" "$snap" && pass "$label rejected_or_fell_back"
      return 0
    fi
    fail "$label" "unexpectedly negotiated forbidden ${target_mv}mV"
    return 1
  fi

  if [ "$rc" -ne 0 ]; then
    fail "$label" "pd set failed"
    return 1
  fi

  sw_mv="$(echo "$snap" | jq -r '.iso_pd.request.mv')"
  port_mv="$(echo "$snap" | jq -r '.port_c.v_mv')"
  ll_mv="$(echo "$snap" | jq -r '.loadlynx.v_local_mv')"
  if ! is_int "$sw_mv" || ! is_int "$port_mv" || ! is_int "$ll_mv"; then
    fail "$label" "missing voltage telemetry target=${target_mv} sw=${sw_mv} port=${port_mv} ll=${ll_mv}"
    return 1
  fi
  if { [ "$mode" = "fixed" ] && [ "$target_mv" -ne 5000 ] && ! advertises_fixed_mv "$out" "$target_mv"; } ||
    { [ "$mode" = "pps" ] && ! advertises_pps_mv "$out" "$target_mv"; }; then
    fail "$label" "target ${target_mv}mV is not advertised in source capabilities"
    return 1
  fi
  d_sw="$(abs_diff "$sw_mv" "$target_mv")"
  d_port="$(abs_diff "$port_mv" "$target_mv")"
  d_ll="$(abs_diff "$ll_mv" "$target_mv")"

  if [ "$d_sw" -le "$tolerance" ] && [ "$d_port" -le "$tolerance" ] && [ "$d_ll" -le "$tolerance" ] && check_no_faults "$label" "$snap"; then
    contract_ma="$(echo "$out" | jq -r '.contract_ma // empty' 2>/dev/null || true)"
    if [ -n "$contract_ma" ]; then
      load_check "$label" "$contract_ma" || return 1
    fi
    pass "$label"
  else
    fail "$label" "voltage mismatch target=${target_mv} sw=${sw_mv} port=${port_mv} ll=${ll_mv}"
  fi
}

print_manual_non_pd() {
  cat <<'MANUAL'
Manual non-PD protocol matrix. These require a matching protocol sink/trigger;
LoadLynx PD sink cannot validate them.

Case            SW2303 config                         Expected sink result
QC2-only        qc20=true, all others false           QC2 fixed tiers trigger; no PD contract
QC3-only        qc30=true, all others false           QC3 continuous/stepped request works; no PD
FCP-only        fcp=true, all others false            FCP trigger works; no PD/QC
AFC-only        afc=true, all others false            AFC trigger works; no PD/QC
SCP-only        scp=true, all others false            SCP trigger and current tier match readback
PE2-only        pe20=true, all others false           PE2 trigger works; no PD/QC
SFCP-only       sfcp=true, all others false           SFCP trigger works; no PD/QC
BC1.2-only      bc12=true, all others false           5V charge signature only; no high-voltage protocol
non-PD-all      PD=false, all non-PD true             Each matching sink can trigger; PD sink cannot
MANUAL
}

run_smoke() {
  defaults || return
  pd_case smoke_fixed_12 fixed 3 12000 1000 accept true 500
  pd_case smoke_pps_11 pps 6 11000 1000 accept true 500
  pd_case smoke_restore_fixed_12 fixed 3 12000 1000 accept true 500
}

run_pd_matrix() {
  defaults || return
  pd_case full_fixed_5 fixed 1 5000 1000 accept true 500
  pd_case full_fixed_9 fixed 2 9000 1000 accept true 500
  pd_case full_fixed_12 fixed 3 12000 1000 accept true 500
  pd_case full_fixed_15 fixed 4 15000 1000 accept true 500
  pd_case full_fixed_20 fixed 5 20000 1000 accept true 650
  pd_case full_pps_5v5 pps 6 5500 1000 accept true 500
  pd_case full_pps_7 pps 6 7000 1000 accept true 500
  pd_case full_pps_11 pps 6 11000 1000 accept true 500
  pd_case full_pps_15 pps 6 15000 1000 accept true 650
  pd_case full_pps_21 pps 6 21000 1000 accept true 800
  run_prune_matrix
}

run_prune_matrix() {
  set_config fixed_none_no_pps "$(make_config 100 true false false false false false false false false false '')" || return
  pd_case fixed_none_reject_9 fixed 2 9000 1000 reject true 500

  set_config fixed_9_only "$(make_config 100 true false false false false false false false false false '9000')" || return
  pd_case fixed_9_only_accept fixed 2 9000 1000 accept true 500
  pd_case fixed_9_only_reject_12 fixed 3 12000 1000 reject true 500

  set_config fixed_9_12_no_pps "$(make_config 100 true false false false false false false false false false '9000,12000')" || return
  pd_case fixed_9_12_accept_9 fixed 2 9000 1000 accept true 500
  pd_case fixed_9_12_accept_12 fixed 3 12000 1000 accept true 500
  pd_case fixed_9_12_reject_15 fixed 4 15000 1000 reject true 500
  pd_case fixed_9_12_reject_pps pps 6 7000 1000 reject true 500

  defaults || return
  pd_case restored_pps_11 pps 6 11000 1000 accept true 500
  pd_case reject_pps_22 pps 6 22000 1000 reject true 800
  pd_case final_fixed_12 fixed 3 12000 1000 accept true 500
}

run_power_matrix() {
  for power in 15 27 45 60 65 100; do
    set_config "power_${power}w_full_pd" "$(make_config "$power" true false false false false false false false false true '9000,12000,15000,20000')" || continue
    case "$power" in
      15) pd_case "power_${power}w_5v" fixed 1 5000 1000 accept true 500 ;;
      27) pd_case "power_${power}w_9v" fixed 2 9000 1000 accept true 500 ;;
      45) pd_case "power_${power}w_15v" fixed 4 15000 1000 accept true 650 ;;
      60|65|100) pd_case "power_${power}w_20v" fixed 5 20000 1000 accept true 800 ;;
    esac
  done
  defaults || return
  pd_case power_matrix_final_12 fixed 3 12000 1000 accept true 500
}

printf 'SW2303 HIL start mode=%s isolapurr=%s loadlynx=%s loadlynx_workdir=%s with_load=%s load_percent=%s\n' \
  "$MODE" "$ISOLAPURR_URL" "$LOADLYNX_HARDWARE" "$LOADLYNX_WORKDIR" "$WITH_LOAD" "$LOAD_PERCENT"

require_loadlynx_usb_pd_control

case "$MODE" in
  smoke|pd|prune|power) capture_original_config ;;
esac

case "$MODE" in
  smoke|pd|prune|power) acquire_hil_lock ;;
esac

case "$MODE" in
  smoke|pd|prune|power) start_lock_heartbeat ;;
esac

case "$MODE" in
  smoke) run_smoke ;;
  pd) run_pd_matrix ;;
  prune) run_prune_matrix ;;
  power) run_power_matrix ;;
  manual-non-pd)
    print_manual_non_pd
    exit 0
    ;;
esac

printf '\nSUMMARY pass=%s fail=%s skip=%s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
