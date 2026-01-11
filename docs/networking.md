# Networking (Wi‑Fi + mDNS + HTTP)

This project includes an **experimental** networking feature (`net_http`) that enables:

- Wi‑Fi STA (DHCP by default; optional static IPv4)
- mDNS hostname resolution: `http://<hostname>.local/`
- mDNS HTTP service discovery: `_http._tcp.local`
- Minimal HTTP server: `GET /` → `Hello World`
- Device HTTP APIs (JSON): `/api/v1/...` (for Web UI integration)
  - CORS allowlist (prod): `https://isolapurr.ivanli.cc`
  - CORS allowlist (dev): `http://localhost:*` / `http://127.0.0.1:*`
  - Private Network Access (PNA) preflight support for Chrome/Chromium HTTPS → HTTP device access

## Build & flash

Networking is behind a Cargo feature gate, and requires compile-time config injection:

1) Create a local `.env` (do not commit):

```sh
USB_HUB_WIFI_SSID=your_ssid
USB_HUB_WIFI_PSK=your_psk

# Optional
USB_HUB_WIFI_HOSTNAME=isolapurr-usb-hub-dev
USB_HUB_WIFI_STATIC_IP=192.168.1.42
USB_HUB_WIFI_NETMASK=255.255.255.0
USB_HUB_WIFI_GATEWAY=192.168.1.1
USB_HUB_WIFI_DNS=192.168.1.1
```

2) Build with networking enabled:

```sh
cargo build --release --features net_http
```

3) Flash via `mcu-agentd` (uses the already-built ELF):

```sh
mcu-agentd flash usb_hub
mcu-agentd monitor usb_hub --reset
```

## Hostname rule

- If `USB_HUB_WIFI_HOSTNAME` is set, it is used as the hostname (sanitized to lowercase `[a-z0-9-]`).
- Otherwise, hostname is derived from the MAC:
  - `short_id = hex(mac[3..6])` (6 chars, lowercase)
  - `hostname = isolapurr-usb-hub-<short_id>`
  - `fqdn = <hostname>.local`

## UI fallback (IP display)

Hold **both** buttons (left + right) for **1–5 seconds**, then **release**, to show:

- `ID <SHORTID>` (derived from MAC; shown in uppercase hex)
- IPv4 (fits on one line), or `NO IP` when not connected
- Holding **> 5 seconds** is treated as invalid and does nothing.

Note: the toast overlay uses a tiny fixed font with limited glyph coverage, so it intentionally avoids rendering the hostname (would show `?`).

## Verification & troubleshooting

### macOS

- Resolve hostname:
  - `ping <hostname>.local`
  - `dns-sd -G v4 <hostname>.local`
- Browse HTTP services:
  - `dns-sd -B _http._tcp`
- Request:
  - `curl http://<hostname>.local/`

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
- No provisioning flow (SSID/PSK are compile-time injected via `.env` or environment variables).
