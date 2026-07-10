---
title: Operational Device Probe Deadlines
module: web
problem_type: async-timeout-contract
component: web-serial
tags:
  - web-serial
  - timeout
  - cancellation
  - hardware-probe
status: active
related_specs:
  - r7m2q
symptoms:
  - A visible countdown reaches zero while the hardware operation continues.
  - A late probe result replaces the timeout state.
  - The board resets long after the UI says the probe has timed out.
root_cause: The countdown was presentation state rather than an operational deadline, and a recognized project response was followed by an unconditional bootloader probe that reset the MCU before accepting the result.
resolution_type: firmware-first-deadline-and-generation-guard
---

# Operational Device Probe Deadlines

## Problem

A hardware countdown is misleading unless it owns the lifetime of the actual
operation. Updating the UI to `0` does not cancel pending port opens, serial
requests, retries, or low-level chip work. Those promises can keep resetting a
board and can later overwrite the visible timeout with stale success data.

## Resolution

- Start the operational deadline only after browser-owned device selection.
- Pass one deadline and one `AbortSignal` through port open, request, retry,
  and low-level probe calls.
- Give every probe a generation ID. Only the active generation may update UI
  state or cache hardware data.
- On expiry, render a terminal timeout immediately and reject all late results.
- Read the product firmware identity API before resetting the MCU.
- Treat a recognized project response as terminal for connection readiness.
  Populate hardware from the firmware report or a board profile bound to both
  project identity and USB VID/PID; do not reset a recognized target merely to
  enrich UI fields.
- Cache low-level hardware truth only when its hardware MAC exactly matches the
  live firmware MAC.
- On a cache miss, run the smallest low-level chip-information sequence. Do not
  use flashing-oriented initialization that uploads a stub or repeats reads.

## Validation Pattern

Cover the behavior at three levels:

1. Unit tests prove hanging opens and pending requests are aborted.
2. Browser tests advance beyond the deadline, release a late response, and
   prove the timeout state is unchanged.
3. Repeated probes prove the recognized target appears inside the performance
   budget. An opt-in browser HIL must bridge only an explicitly supplied serial
   path, assert the expected device ID and MAC, and fail if a recognized target
   emits any DTR/RTS control signal.

The browser device picker is not part of the hardware deadline because its
duration is controlled by the owner. No countdown should appear during that
stage.

## Reuse Rule

Never ship a device-operation countdown that is derived only from elapsed UI
time. The same deadline must govern the underlying I/O and the authority to
publish results.

## References

- `docs/specs/r7m2q-cli-devd-alignment/SPEC.md`
- `web/src/pages/useFirmwareFlashConnection.ts`
- `web/src/domain/webSerialFirmware.ts`
