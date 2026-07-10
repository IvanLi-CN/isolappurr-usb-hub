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
root_cause: The countdown was presentation state rather than an operational deadline, and the probe performed stale-port polling plus flashing-oriented esptool initialization before accepting results.
resolution_type: deadline-and-generation-guard
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
   budget, while exact-device HIL confirms the firmware API identity.

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
