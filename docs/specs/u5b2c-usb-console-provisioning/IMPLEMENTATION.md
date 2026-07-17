# Implementation

## Current State

- Created as the canonical topic spec for USB communication, firmware update, and Wi-Fi provisioning.
- The three supported communication paths are now described as equal product-grade delivery routes with different capability boundaries, not as a hierarchy.
- Firmware enables `net_http` by default for Local USB JSONL, Wi-Fi, mDNS, and HTTP support; it no longer requires build-time `USB_HUB_WIFI_SSID` or `USB_HUB_WIFI_PSK`.
- Firmware loads Wi-Fi credentials from EEPROM U21 `0x50` at boot and exposes a USB Serial/JTAG JSONL control task.
- Local USB exposes token-protected serial port listing, JSONL request forwarding, and selected binary firmware flash execution through the desktop app. The same core logic is available through `isolapurr-desktop` CLI for development-stage hardware work.
- Web UI keeps device connection inside the original Add device modal. Firmware update and Wi-Fi configuration live on the selected device's Hardware page. The standalone Hardware Console route and panel were removed so USB setup cannot bypass the add-device flow.
- Web actions now use shared `ActionButton`, `IconButton`, and `ConfirmDialog` primitives. Normal commands, safe alternatives, reset/clear actions, and destructive final confirmation have explicit semantic treatments instead of page-local button classes.

## Coverage

- Firmware USB JSONL: implemented for `info`, `ports.get`, `port.power_set`, `port.replug`, `wifi.get`, `wifi.set`, `wifi.clear`, `settings.reset`, and `reboot`.
- Firmware USB JSONL rejects malformed port actions instead of defaulting to a port or power state.
- Local USB ESP32 port filtering accepts ESP32-S3 USB Serial/JTAG by VID/PID across macOS, Windows, and Linux path naming, while still excluding Bluetooth/debug-console noise.
- Firmware Wi-Fi HTTP channel: implemented for `info`, `ports.get`, port power/replug actions, and `wifi.get`. HTTP rejects `wifi.set`, `wifi.clear`, and Wi-Fi apply `reboot` with `unsafe_transport` because Wi-Fi configuration changes require Web Serial or Local USB.
- EEPROM Wi-Fi config: implemented with magic/version/checksum record, SSID/PSK fields, optional static IPv4 fields, and queued runtime writes through the telemetry I2C bus.
- Local USB: implemented for serial enumeration, JSONL request proxying, single-operation serial lock, `espflash save-image`, identity-checked `espflash write-bin` at `0x10000`, reset, and monitor using the user-selected app `.bin` and port path. First-time hardware or download mode can use the same selected port for one explicitly confirmed bootstrap flash before identity is available.
- Development CLI: implemented `serial ports`, `serial identify`, `serial request`, `firmware make-bin`, `firmware flash`, `firmware reset`, and `firmware monitor`. `just desktop-agent-build` builds the CLI once; `just ports` and related selector commands then execute the existing binary without implicit rebuilds. `just identify` writes `.esp32-port` with the owner-confirmed port plus `device_id`/`mac`; `just select-port` can also cache an `identity=unconfirmed` owner-confirmed port when `info` times out; `just flash` uses `espflash flash` on the release ELF for unconfirmed bootstrap flashing, then confirms identity; `just flash-monitor` validates identity, flashes only the app `.bin`, resets, and monitors without `mcu-agentd`.
- Web transports and Add device UI: implemented with Add device flows for Wi-Fi / LAN, Web Serial, and Local USB; Web Serial JSONL; Local USB JSONL; and Wi-Fi HTTP channel.
- Device runtime: implemented concurrent Wi-Fi / LAN, Web Serial, and Local USB channel tracking. The active channel remains primary while healthy; when it fails, polling and controls promote the next available channel for the same saved device.
- Browser single-writer runtime: implemented a same-origin leader/follower coordinator so one leader tab owns discovery, transport bootstrap, polling, and hardware writes while follower tabs consume shared snapshots and use explicit takeover to become leader.
- Cross-tab state propagation: implemented BroadcastChannel-first snapshot and message sync with a localStorage fallback, plus a browser-persistent per-device power-lock owner store so refresh and short reopen flows can resume the same host-lock identity inside the TTL window.
- Web runtime transport recovery: implemented a stricter split between transient Web Serial request failures and hard disconnects. Runtime channel selection now drops stale Web Serial state when the live browser link is gone, falls back to another immediately available channel for `deviceInfo()` and polling, and keeps Serial list badges in a history state unless a live link still exists.
- Runtime preference: when multiple channels are already available, the runtime can keep using the last successful channel for that device as the default primary. This is a selection heuristic, not a product-quality ranking.
- Communication path documentation: updated the product entry docs and this spec with a path matrix covering why multiple schemes exist, each path's immediate-availability prerequisite, intended use, and real capability boundary.
- USB-to-Wi-Fi binding: after Web Serial or Local USB `info`, the Add device flow probes a reported Wi-Fi IPv4 over HTTP, requires matching full `device_id`, persists the verified Wi-Fi base URL, and publishes the Wi-Fi / LAN channel without waiting for a page refresh.
- Wi-Fi / LAN address correction: discovery now prefers the verified IPv4 URL over the mDNS URL, and successful matching HTTP `info` polls can correct older saved mDNS URLs to the verified IPv4 URL without changing transport arbitration semantics.
- HTTP error classification: browser private-network blocking, `.local` name/reachability failures, and structured device API errors are now surfaced as separate user-facing categories instead of collapsing every secure-origin fetch failure into a generic preflight error.
- Web HTTP timeout budget: verified IPv4 requests keep the tighter default timeout, while `.local` requests use a slightly longer timeout budget so resolver-latency environments are less likely to misclassify a slow mDNS hostname as a hard device outage.
- macOS `.local` follow-up diagnosis: HIL on `856a141cdbd4` showed healthy direct IPv4 HTTP while generic `.local` access spent about 5 seconds in hostname resolution; `AF_INET` resolution was immediate but `AF_UNSPEC` / `AF_INET6` stalled, so the remaining instability is tracked as a host resolver / IPv6 interaction rather than a device HTTP outage.
- Firmware HTTP listener pool: the LAN API now uses a small multi-listener `TcpSocket` pool instead of a single listener, following the `embassy-net` model for accepting many incoming connections on one port. Each slot still keeps a 2-second idle timeout so speculative browser sockets release quickly.
- Single-device LAN concurrency: HIL confirmed that the listener-pool firmware on `856a141cdbd4` removes the prior sibling-request refusal pattern for concurrent same-device HTTP traffic, while an older-firmware device (`f293cc9c139e`) still reproduces the unstable behavior. The Web runtime still queues same-device HTTP work to stay conservative on constrained hardware and to keep owner-facing behavior predictable.
- Web and desktop storage now treat the full 12-character `device_id` as the only saved-device primary key. Legacy local records that do not use the canonical `device_id` are cleared instead of migrated by hostname, MAC, or random storage IDs.
- Web Serial robustness: JSONL reading uses a single background read loop with per-request response matching, so request timeouts do not leave abandoned `reader.read()` calls that can block the first authorized connection attempt.
- Connection observability: Web Serial and Local USB add-device flows render a recent connection log covering authorization/open, `info` attempts, Wi-Fi probe, save/bind, and failures.
- Runtime Wi-Fi apply: implemented with an in-memory Wi-Fi apply signal. After EEPROM store succeeds, the Wi-Fi task reconnects immediately with the new credentials. After EEPROM clear succeeds, the Wi-Fi task stops the station immediately. Devices with empty EEPROM still spawn the network task in idle mode so later USB provisioning can bring Wi-Fi online without reboot.
- Device Hardware page: implemented firmware update of a selected app `.bin` at `0x10000` through Local USB or Web Serial for the saved device, plus Wi-Fi configuration read/save/clear controls and saved-device deletion with confirmation. Wi-Fi configuration is read-only over Wi-Fi / LAN; credential changes require Web Serial or Local USB.
- Product docs: the entry README, interaction spec, and this topic spec now explain why three communication schemes exist, which capabilities each one covers, and why default preference only matters when more than one path is immediately usable.
- Storybook and visual evidence: implemented for disconnected, connected, flashing, Wi-Fi configured, Wi-Fi empty/error, immediate apply, mobile, offline failover, add-device connection log, and delete confirmation states.
- Device info identity layout: saved-device Hardware page now uses a shared two-column info-row layout so long `device_id`, `hostname`, and `fqdn` values truncate predictably instead of drifting off-grid; Storybook covers wide and narrow long-identity regressions.
- Action-system coverage: migrated production command controls across discovery, saved-device settings, reset, firmware flash, port power, power calibration, device add, theme selection, and demo controls. Selection cards and segmented controls retain their distinct selection semantics.
- Action-system accessibility: confirmation dialogs render above the app root, restore focus on close, trap keyboard focus while open, and support Escape dismissal when not busy. Storybook play coverage checks the portal-backed deletion and calibration confirmations.
- Theme-surface coverage: shared action tokens now cover primary, secondary, quiet, warning, danger, disabled, and loading states; shared form-field overrides keep disabled text inputs on `--panel-2` rather than leaking a light framework default into dark or system-dark mode.

## Validation

- `cargo build --release`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun test ./src`
- `cd web && bun run test:e2e`
- `cd web && bun run build-storybook`
- `cd desktop/src-tauri && cargo test`
- `just --list`
- `just host-tools-build`
- `just host-tools-test`
- GitHub Actions pass for Firmware, Web quality gates, Deploy web build, Dependency Review, and Desktop macOS/Windows/Linux/Linux ARM/Windows ARM packaging.
- Local USB hardware flash: generated an ESP32-S3 app `.bin` with `espflash save-image`, flashed it through `/api/v1/firmware/flash` at `0x10000`, and read back `info` from `/api/v1/serial/request`.
- Web Serial hardware flash: selected the saved device's current Web Serial channel from the Hardware page, wrote the ESP32-S3 app `.bin` at `0x10000`, did not open the Add device/browser serial chooser during update, restored the Web Serial channel after reboot, and re-read `info` for the full 12-character `device_id`.
- Web runtime hardware validation: an existing Wi-Fi device with the same `device_id` connected over Web Serial, promoted Web Serial as primary, updated telemetry without adding a duplicate list entry, and displayed connection-channel badges in the device list.
- Web reset hardware validation: served `web/dist` from `isolapurr-devd bridge-http`, opened the Device Hardware page against a Local USB-backed saved device, seeded saved Wi-Fi credentials plus non-default USB-C route and manual TPS state, then verified `Reset other settings` restored runtime defaults while preserving Wi-Fi and `Reset Wi-Fi` cleared credentials without re-persisting power or route settings.
- Storybook visual evidence refreshed from `Dialogs/AddDeviceDialog / WebSerialSetup`, `Dialogs/AddDeviceDialog / LocalUsbSetup`, `Panels/DeviceInfoPanel / WebSerialFlashing`, and `Cards/DeviceCard / ConnectedAndHistory`.
- Storybook visual evidence refreshed for `Cards/DeviceCard / SerialHistoryOnly` so the device list badge contract now proves that a historical Web Serial channel is rendered as history instead of a live connected Serial badge.
- Device selection now uses theme-specific selected surface, border, and ring tokens plus a visible check marker and `aria-current="page"`; `Cards/DeviceCard` autodocs and the light, dark, and mobile `Layouts/AppLayout` stories cover the selected and unselected states together.
- Storybook visual evidence refreshed for `Panels/DeviceInfoPanel / LongIdentityValues` and `Panels/DeviceInfoPanel / NarrowLongIdentityValues` so the Identity panel proves stable label/value alignment and predictable truncation for long identifiers and FQDNs on desktop and narrow layouts.
- `cd web && bun run build`
- `cd web && bun test ./src`
- `cd web && bun run build-storybook`
- `cd web && bun run test:storybook`
- Production demo visual review at `/devices/aabbcc001122/info?demo=true` for desktop, narrow, `isolapurr-dark`, and `system` rendering.
