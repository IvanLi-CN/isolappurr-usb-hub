# Firmware LAN HTTP needs a small listener pool, not a single listener

## Problem

Remote Web LAN access was intermittently failing even when:

- Wi-Fi association was healthy
- direct USB `info` still succeeded
- the device already had a valid IPv4 address

The visible failures looked like:

- one LAN request succeeding while adjacent requests returned `connection refused`
- the UI misreporting LAN instability as generic browser preflight trouble
- `.local` confusion hiding a deeper direct-IPv4 problem

## Verified evidence

Two HIL devices made the split clear:

- `856a141cdbd4` (`192.168.31.122`) reproduced the issue before the firmware fix
- `f293cc9c139e` (`192.168.31.224`) still reproduces it on older firmware

Before the fix:

- sequential direct IPv4 requests could succeed
- concurrent `GET /api/v1/health`, `GET /api/v1/info`, `GET /api/v1/ports` could drop sibling requests
- an idle TCP connection to port `80` could temporarily consume the only available HTTP slot

After flashing the listener-pool firmware to `856a141cdbd4`:

- sequential direct IPv4 requests stayed healthy
- concurrent `health/info/ports` all returned HTTP 200
- the idle TCP hold test no longer caused request failures in the same way

Meanwhile `f293cc9c139e` on older firmware still showed mixed `200` and `connection refused`, which isolates the change to firmware behavior rather than host luck.

## Root cause

`embassy-net` does not provide a traditional `TcpListener` with backlog. Its documented model is:

- each `TcpSocket` can `accept()`
- to accept many incoming connections, create many sockets and have them all listen on the same port

The original firmware only created one `TcpSocket` for HTTP, so the entire LAN API had exactly one live accept slot.

## Fix

### Firmware

- keep a short per-connection idle timeout (`2s`)
- spawn a small HTTP listener pool (`3` listeners)
- each listener owns its own `TcpSocket` and accepts port `80` independently

### Web runtime

- still serialize same-device HTTP requests in the runtime
- preserve clearer owner-facing error classes: `Name/Reachability`, `Browser blocked`, `Device API error`

The runtime queue remains useful because the device is still resource-constrained and should not be hammered unnecessarily, even though the hard single-listener bottleneck is gone.

## Product consequence

- Verified IPv4 remains the recommended saved LAN URL.
- `.local` still exists as an mDNS URL for manual input and diagnostics.
- A LAN failure should not be labeled as pure PNA/CORS unless browser blocking is actually what happened.

## Reuse rule

When diagnosing future LAN instability:

1. test direct verified IPv4 first
2. compare sequential versus concurrent same-device requests
3. test `.local` separately from direct IPv4
4. confirm the device firmware actually contains the listener-pool fix before blaming the browser
