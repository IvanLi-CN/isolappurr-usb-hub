# Networking (Wi‑Fi + mDNS + HTTP LAN access)

This page documents the device networking runtime and Wi-Fi / LAN HTTP access. The product Web App uses Add device for Wi-Fi / LAN, Web Serial, and Local USB connection, then uses the saved device pages for Wi-Fi maintenance, telemetry, controls, and firmware update. A saved hub may have Wi-Fi and USB channels active at the same time; the runtime promotes an available channel when the current primary fails. Treat the flashing notes below as a developer maintenance path, not the user-facing onboarding path.

This project includes an **experimental** networking feature (`net_http`) that enables:

- Wi‑Fi STA (DHCP by default; optional static IPv4)
- mDNS URL: `http://<hostname>.local/` (manual / diagnostic LAN entry)
- mDNS HTTP service discovery: `_http._tcp.local`
- Minimal HTTP server: `GET /` → `Hello World`
- Device HTTP APIs (JSON): `/api/v1/...` (for Web UI integration)
  - CORS allowlist (prod): `https://isolapurr.ivanli.cc`
  - CORS allowlist (dev): `http://localhost:*` / `http://127.0.0.1:*`
- Private Network Access (PNA) preflight support for Chrome/Chromium HTTPS → HTTP device access

## Recommended saved LAN address

For the product Web App, the recommended saved LAN address is a verified IPv4 URL:

- Preferred: `http://<ipv4>`
- Optional mDNS URL for manual input or diagnostics: `http://<hostname>.local`

Reason:

- verified IPv4 avoids resolver differences across macOS / Linux / browser environments
- the mDNS URL can still work, but it depends on mDNS / local name resolution and may be less stable across environments
- on some macOS networks, `.local` can be delayed by an IPv6 / `AAAA` resolver path even when IPv4 HTTP is healthy
- the Web app gives `.local` requests a slightly longer timeout budget than verified IPv4 so slow resolver paths are less likely to be misclassified as hard device outages
- the Web UI now treats `.local` reachability failures and browser private-network blocking as different user-facing problems

## Build

Networking is behind a Cargo feature gate. Wi-Fi credentials are not supplied at build time; the Web App provisions them at runtime and the firmware stores them in EEPROM U21 (`0x50`).

Build with networking enabled:

```sh
cargo build --release --features net_http
```

For firmware maintenance in a developer checkout, use the repo's owner-confirmed flashing workflow. Do not treat developer flashing commands as the product connection, provisioning, or update flow.

## Hostname rule

- If `USB_HUB_WIFI_HOSTNAME` is set, it is used as the hostname (sanitized to lowercase `[a-z0-9-]`).
- Otherwise, hostname is derived from the base eFuse MAC:
  - `device_id = hex(mac[3..6] + mac[0..3])` (12 chars, lowercase)
  - `hostname = isolapurr-usb-hub-<device_id>`
  - `fqdn = <hostname>.local`

## UI fallback (IP display)

Hold **both** buttons (left + right) for **1–5 seconds**, then **release**, to show:

- `ID <SHORTID>` where `SHORTID` is the first 6 chars of the full `device_id`, shown in uppercase hex
- IPv4 (fits on one line), or `NO IP` when not connected
- Holding **> 5 seconds** is treated as invalid and does nothing.

Note: the toast overlay uses a tiny fixed font with limited glyph coverage, so it intentionally avoids rendering the hostname (would show `?`).

## Verification & troubleshooting

### macOS

- Resolve hostname:
  - `ping <hostname>.local`
  - `dns-sd -G v4 <hostname>.local`
- Compare resolver family timing when `.local` feels slow:
  - `python3 - <<'PY'` / `socket.getaddrinfo(... AF_UNSPEC vs AF_INET ...)`
  - `curl -4 http://<hostname>.local/api/v1/info`
- Browse HTTP services:
  - `dns-sd -B _http._tcp`
- Request:
  - `curl http://<hostname>.local/`

If `curl -4` is fast but plain `curl http://<hostname>.local/...` spends about 5 seconds in name lookup, the device HTTP server is probably fine and the macOS `.local` resolver path is the slow layer.

### Linux (Avahi)

- Resolve hostname:
  - `getent hosts <hostname>.local`
- Browse HTTP services:
  - `avahi-browse -art |_http._tcp`
- Request:
  - `curl http://<hostname>.local/`

## HTTP APIs (`/api/v1`)

All `/api/v1/*` endpoints:

- return `application/json; charset=utf-8`
- include `Cache-Control: no-store`
- support CORS (see below)

Endpoints:

- `GET /api/v1/health` → `{ "ok": true }`
- `GET /api/v1/info` → device identity + Wi‑Fi state
- `GET /api/v1/ports` → dual-port snapshot (`port_a` / `port_c`)
- `GET /api/v1/ports/{portId}` → single port object
- `POST /api/v1/ports/{portId}/actions/replug`
- `POST /api/v1/ports/{portId}/power?enabled={0|1}`

## CORS + Private Network Access (Chrome / Chromium)

Goal: allow the GitHub Pages site (`https://isolapurr.ivanli.cc/`) to call an HTTP device on your LAN.

Notes:

- Target browser: **Chrome / Chromium** (Safari is out of scope).
- When requesting a private network HTTP device from an HTTPS page, Chrome will run an `OPTIONS` preflight (PNA).
- The firmware responds with:
  - `Access-Control-Allow-Origin` (allowlist)
  - `Access-Control-Allow-Private-Network: true` (when requested)
  - `Private-Network-Access-ID/Name` for the Chrome permission prompt

User-facing diagnosis now splits failures into separate buckets:

- `Name/Reachability`: the saved hostname or LAN path could not be reached; prefer a verified IPv4
- `Browser blocked`: Chrome/Chromium blocked private-network access from the HTTPS page
- `Device API error`: the device responded, but the API returned a structured error

For `.local`, the product also treats hostname timeouts as `Name/Reachability` because some host environments delay `.local` resolution even while verified IPv4 HTTP stays healthy.

### Quick checks (curl)

Basic CORS:

```sh
curl -i \
  -H 'Origin: https://isolapurr.ivanli.cc' \
  http://<hostname>.local/api/v1/health
```

PNA preflight (simulated):

```sh
curl -i -X OPTIONS \
  -H 'Origin: https://isolapurr.ivanli.cc' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Private-Network: true' \
  http://<hostname>.local/api/v1/ports
```

## Known limitations

- IPv4 only (no IPv6 / mDNS over IPv6 yet).
- Provisioning is handled by the Web App; this page only covers the runtime networking and Wi-Fi / LAN HTTP surface.

## Wi‑Fi / LAN discovery helper

The legacy Desktop local agent can help the Wi-Fi / LAN path fill the `CIDR` for **IP scan (advanced)** without starting a scan automatically. This helper is not a USB connection path; USB setup uses Web Serial or Local USB in Add device, while firmware update belongs to the saved device's Hardware page.

Where it shows up:

- `GET /api/v1/discovery/snapshot` (Desktop local agent) includes:
  - `ipScan.defaultCidr` (string)
  - `ipScan.candidates[]` (list)

Rules (high-level):

- IPv4 only.
- Candidates are derived from the host network interfaces (via the `default-net` crate).
- Filters out loopback and link-local (`169.254.0.0/16`), and only keeps private IPv4 (RFC1918).
- Filters out TUN / tunnel / PPP-like interfaces to avoid VPN/virtual adapters.
- `defaultCidr` is the candidate corresponding to the default interface (best-effort); if there is only one candidate, that one is used.
- The UI never auto-starts a scan; a scan only begins after the user clicks `Scan`.
