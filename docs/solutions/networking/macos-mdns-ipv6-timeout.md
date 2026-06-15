# macOS `.local` mDNS access delayed by IPv6 resolver timeout

## Problem

On some macOS Wi-Fi environments, a device's `.local` hostname can appear "flaky" even when:

- mDNS service discovery works
- `A` resolution for the hostname is valid
- the device HTTP server is healthy

The observable symptom is that generic clients using the system default address-family selection (`AF_UNSPEC`) spend about 5 seconds before the first HTTP byte, then either barely succeed or hit a 4-5 second client timeout budget.

## Verified evidence

Observed against `isolapurr-usb-hub-856a141cdbd4.local` on macOS:

- `socket.getaddrinfo(..., AF_INET)` resolved immediately (`~0.001s`)
- `socket.getaddrinfo(..., AF_UNSPEC)` took `~5.006s`
- `socket.getaddrinfo(..., AF_INET6)` also took `~5.003s`
- `curl -4 http://<hostname>.local/api/v1/info` completed in `~0.02s`
- plain `curl http://<hostname>.local/api/v1/info` spent `~5.00s` in `time_namelookup`
- direct IPv4 HTTP to `http://192.168.31.122/api/v1/info` stayed healthy (`~0.016s`, HTTP 200)

That split proves the device and IPv4 LAN path are fine. The slow path is the hostname-resolution strategy, not the device HTTP server itself.

## Likely cause

The host interface had active global IPv6 addresses, while the device networking contract is still IPv4-only. In this state, macOS resolver behavior for `.local` can stall on the IPv6/`AAAA` side before returning the usable IPv4 answer to generic clients.

This project does not yet provide IPv6 / mDNS-over-IPv6 service from the device, so the client-side IPv6 attempt becomes a latency trap instead of a useful path.

## Practical product consequence

- `.local` should not be treated as the recommended saved LAN URL for remote Web
- verified IPv4 should remain the primary saved LAN address
- `.local` failures or timeouts should surface as `Name/Reachability`, not as generic offline or generic PNA/preflight errors

## Recommended diagnostics

Use this sequence to separate resolver delay from device failure:

```sh
python3 - <<'PY'
import socket, time
host='isolapurr-usb-hub-856a141cdbd4.local'
for family,name in [(socket.AF_UNSPEC,'AF_UNSPEC'),(socket.AF_INET,'AF_INET'),(socket.AF_INET6,'AF_INET6')]:
    t0=time.time()
    try:
        socket.getaddrinfo(host,80,family,socket.SOCK_STREAM)
        ok=True
    except Exception as e:
        ok=repr(e)
    print(name, round(time.time()-t0,3), ok)
PY
```

```sh
curl -4 -w '\nlookup=%{time_namelookup} total=%{time_total}\n' -o /dev/null -s \
  http://<hostname>.local/api/v1/info

curl -w '\nlookup=%{time_namelookup} total=%{time_total}\n' -o /dev/null -s \
  http://<hostname>.local/api/v1/info
```

If `curl -4` is fast while the default `curl` spends about 5 seconds in lookup, the problem is resolver-family behavior rather than device HTTP health.

## Reuse rule

When the product only guarantees IPv4 LAN service, any `.local` slow-path diagnosis should first test:

1. verified IPv4 direct HTTP
2. `AF_INET` vs `AF_UNSPEC` resolution timing
3. whether the host has active IPv6 routes on the same interface

Do not jump from "slow `.local`" to "device HTTP broken" or "pure browser PNA issue" without this split.
