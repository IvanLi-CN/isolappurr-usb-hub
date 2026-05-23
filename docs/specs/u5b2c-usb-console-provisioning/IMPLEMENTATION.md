# Implementation

## Current State

- Created as the canonical topic spec for USB communication, firmware update, and Wi-Fi provisioning.
- Firmware enables `net_http` by default for Local USB JSONL, Wi-Fi, mDNS, and HTTP support; it no longer requires build-time `USB_HUB_WIFI_SSID` or `USB_HUB_WIFI_PSK`.
- Firmware loads Wi-Fi credentials from EEPROM U21 `0x50` at boot and exposes a USB Serial/JTAG JSONL control task.
- Local USB exposes token-protected serial port listing, JSONL request forwarding, and selected binary firmware flash execution through the desktop app. The same core logic is available through `isolapurr-desktop` CLI for development-stage hardware work.
- Web UI keeps device connection inside the original Add device modal. Firmware update and Wi-Fi configuration live on the selected device's Hardware page. The standalone Hardware Console route and panel were removed so USB setup cannot bypass the add-device flow.

## Coverage

- Firmware USB JSONL: implemented for `info`, `ports.get`, `port.power_set`, `port.replug`, `wifi.get`, `wifi.set`, `wifi.clear`, and `reboot`.
- Firmware USB JSONL rejects malformed port actions instead of defaulting to a port or power state.
- Local USB ESP32 port filtering accepts ESP32-S3 USB Serial/JTAG by VID/PID across macOS, Windows, and Linux path naming, while still excluding Bluetooth/debug-console noise.
- Firmware Wi-Fi HTTP fallback: implemented for `info`, `ports.get`, port power/replug actions, and `wifi.get`. HTTP rejects `wifi.set`, `wifi.clear`, and Wi-Fi apply `reboot` with `unsafe_transport` because Wi-Fi configuration changes require Web Serial or Local USB.
- EEPROM Wi-Fi config: implemented with magic/version/checksum record, SSID/PSK fields, optional static IPv4 fields, and queued runtime writes through the telemetry I2C bus.
- Local USB: implemented for serial enumeration, JSONL request proxying, single-operation serial lock, `espflash save-image`, identity-checked `espflash write-bin` at `0x10000`, reset, and monitor using the user-selected app `.bin` and port path. First-time hardware or download mode can use the same selected port for one explicitly confirmed app flash before identity is available.
- Development CLI: implemented `serial ports`, `serial identify`, `serial request`, `firmware make-bin`, `firmware flash`, `firmware reset`, and `firmware monitor`. `just desktop-agent-build` builds the CLI once; `just ports` and related selector commands then execute the existing binary without implicit rebuilds. `just identify` writes `.esp32-port` with the owner-confirmed port plus `device_id`/`mac`; `just select-port` can also cache an `identity=unconfirmed` owner-confirmed port when `info` times out; `just flash` writes the app `.bin` and then confirms identity; `just flash-monitor` validates identity, flashes, resets, and monitors without `mcu-agentd`.
- Web transports and Add device UI: implemented with Add device flows for Wi-Fi / LAN, Web Serial, and Local USB; Web Serial JSONL; Local USB JSONL; and Wi-Fi HTTP fallback.
- Device runtime: implemented concurrent Wi-Fi / LAN, Web Serial, and Local USB channel tracking. The active channel remains primary while healthy; when it fails, polling and controls promote the next available channel for the same saved device.
- USB-to-Wi-Fi binding: after Web Serial or Local USB `info`, the Add device flow probes a reported Wi-Fi IPv4 over HTTP, requires matching `device_id` or `mac`, persists the verified Wi-Fi base URL, and publishes the Wi-Fi / LAN channel without waiting for a page refresh.
- Web Serial robustness: JSONL reading uses a single background read loop with per-request response matching, so request timeouts do not leave abandoned `reader.read()` calls that can block the first authorized connection attempt.
- Connection observability: Web Serial and Local USB add-device flows render a recent connection log covering authorization/open, `info` attempts, Wi-Fi probe, save/bind, and failures.
- Runtime Wi-Fi apply: implemented with an in-memory Wi-Fi apply signal. After EEPROM store succeeds, the Wi-Fi task reconnects immediately with the new credentials. After EEPROM clear succeeds, the Wi-Fi task stops the station immediately. Devices with empty EEPROM still spawn the network task in idle mode so later USB provisioning can bring Wi-Fi online without reboot.
- Device Hardware page: implemented firmware update of a selected app `.bin` at `0x10000` through Local USB or Web Serial for the saved device, plus Wi-Fi configuration read/save/clear controls and saved-device deletion with confirmation. Wi-Fi configuration is read-only over Wi-Fi / LAN; credential changes require Web Serial or Local USB.
- Storybook and visual evidence: implemented for disconnected, connected, flashing, Wi-Fi configured, Wi-Fi empty/error, immediate apply, mobile, offline fallback, add-device connection log, and delete confirmation states.

## Validation

- `cargo build --release`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun test ./src`
- `cd web && bun run test:e2e`
- `cd web && bun run build-storybook`
- `cd desktop/src-tauri && cargo test`
- `just --list`
- GitHub Actions pass for Firmware, Web quality gates, Deploy web build, Dependency Review, and Desktop macOS/Windows/Linux/Linux ARM/Windows ARM packaging.
- Local USB hardware flash: generated an ESP32-S3 app `.bin` with `espflash save-image`, flashed it through `/api/v1/firmware/flash` at `0x10000`, and read back `info` from `/api/v1/serial/request`.
- Web Serial hardware flash: selected the saved device's current Web Serial channel from the Hardware page, wrote the ESP32-S3 app `.bin` at `0x10000`, did not open the Add device/browser serial chooser during update, restored the Web Serial channel after reboot, and re-read `info` for `device_id=f293cc`.
- Web runtime hardware validation: an existing Wi-Fi device with the same `device_id` connected over Web Serial, promoted Web Serial as primary, updated telemetry without adding a duplicate list entry, and displayed connection-channel badges in the device list.
- Storybook visual evidence refreshed from `Dialogs/AddDeviceDialog / WebSerialSetup`, `Dialogs/AddDeviceDialog / LocalUsbSetup`, `Panels/DeviceInfoPanel / WebSerialFlashing`, and `Cards/DeviceCard / ConnectedAndHistory`.
