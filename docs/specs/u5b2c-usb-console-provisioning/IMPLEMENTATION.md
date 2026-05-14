# Implementation

## Current State

- Created as the canonical topic spec for USB communication, firmware update, and Wi-Fi provisioning.
- Firmware no longer requires build-time `USB_HUB_WIFI_SSID` or `USB_HUB_WIFI_PSK` for `net_http`.
- Firmware loads Wi-Fi credentials from EEPROM U21 `0x50` at boot and exposes a USB Serial/JTAG JSONL control task.
- Local USB exposes token-protected serial port listing, JSONL request forwarding, and selected binary firmware flash execution through the desktop app.
- Web UI keeps device connection inside the original Add device modal. Firmware update lives on the selected device's Hardware page. The standalone Hardware Console route and panel were removed so USB setup cannot bypass the add-device flow.

## Coverage

- Firmware USB JSONL: implemented for `info`, `ports.get`, `port.power_set`, `port.replug`, `wifi.get`, `wifi.set`, `wifi.clear`, and `reboot`.
- Firmware USB JSONL rejects malformed port actions instead of defaulting to a port or power state.
- Firmware Wi-Fi HTTP fallback: implemented for `info`, `ports.get`, port power/replug actions, `wifi.get`, `wifi.set`, `wifi.clear`, and `reboot`.
- EEPROM Wi-Fi config: implemented with magic/version/checksum record, SSID/PSK fields, optional static IPv4 fields, and queued runtime writes through the telemetry I2C bus.
- Local USB: implemented for serial enumeration, JSONL request proxying, single-operation serial lock, and `espflash write-bin` execution using the user-selected app `.bin` and port path.
- Web transports and Add device UI: implemented with Add device flows for Wi-Fi / LAN, Web Serial, and Local USB; Web Serial JSONL; Local USB JSONL; and Wi-Fi HTTP fallback.
- Device runtime: implemented concurrent Wi-Fi / LAN, Web Serial, and Local USB channel tracking. The active channel remains primary while healthy; when it fails, polling and controls promote the next available channel for the same saved device.
- Device Hardware page: implemented firmware update of a selected app `.bin` at `0x10000` through Local USB or Web Serial for the saved device.
- Storybook and visual evidence: implemented for disconnected, connected, flashing, Wi-Fi configured, Wi-Fi error, and offline fallback states.

## Validation

- `cargo build --release --features net_http`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun test ./src`
- `cd web && bun run test:e2e`
- `cd web && bun run build-storybook`
- `cd desktop/src-tauri && cargo test`
- GitHub Actions pass for Firmware, Web quality gates, Deploy web build, Dependency Review, and Desktop macOS/Windows/Linux/Linux ARM/Windows ARM packaging.
- Local USB hardware flash: generated an ESP32-S3 app `.bin` with `espflash save-image`, flashed it through `/api/v1/firmware/flash` at `0x10000`, and read back `info` from `/api/v1/serial/request`.
- Web Serial hardware flash: selected the saved device's current Web Serial channel from the Hardware page, wrote the ESP32-S3 app `.bin` at `0x10000`, did not open the Add device/browser serial chooser during update, restored the Web Serial channel after reboot, and re-read `info` for `device_id=f293cc`.
- Web runtime hardware validation: an existing Wi-Fi device with the same `device_id` connected over Web Serial, promoted Web Serial as primary, updated telemetry without adding a duplicate list entry, and displayed connection-channel badges in the device list.
- Storybook visual evidence refreshed from `Dialogs/AddDeviceDialog / WebSerialSetup`, `Dialogs/AddDeviceDialog / LocalUsbSetup`, `Panels/DeviceInfoPanel / WebSerialFlashing`, and `Cards/DeviceCard / ConnectedAndHistory`.
