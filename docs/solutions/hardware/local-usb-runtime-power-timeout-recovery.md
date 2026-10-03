# Local USB Runtime Power Timeout Recovery

## Problem

A USB JSONL command can apply on the device while its response is lost during
a short serial busy window. Treating every timeout as a failed power command
causes an operator or automation to retry a command whose hardware effect is
already present.

## Decision

For idempotent runtime booleans such as TPS output enable and discharge enable:

1. Send the requested command once.
2. On a serial timeout or serial read failure, wait for the bounded device
   settle interval.
3. Read the live power-config/runtime snapshot.
4. Return verified success only when the matching runtime boolean equals the
   requested value.
5. Otherwise retain the original transport failure.

Do not replay the mutating command automatically. Do not treat a merely
reachable device as proof that the command applied.

Read-only telemetry requests use a separate rule: after a transient serial
timeout or read failure, reopen the serial transport once and repeat only the
query. Use a short query deadline so a stale collector does not block the next
sample window.

## Boundary

Runtime output and discharge state are not persisted power configuration. This
recovery must not modify or restore the saved configuration payload, including
manual voltage, current, source capability, or `manual.tps_cdc_rise_mv` cable
compensation.

## Verification

Use a unit test with a stale runtime value first and the requested value after
the retry window. The helper must reject the stale value and accept only the
exact requested state.
