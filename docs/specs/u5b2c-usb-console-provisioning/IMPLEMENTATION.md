# Implementation

## Current State

- Created as the canonical topic spec for USB communication, firmware update, and Wi-Fi provisioning.
- Firmware no longer requires build-time `USB_HUB_WIFI_SSID` or `USB_HUB_WIFI_PSK` for `net_http`.
- Firmware loads Wi-Fi credentials from EEPROM U21 `0x50` at boot and exposes a USB Serial/JTAG JSONL control task.
- Desktop native proxy exposes token-protected serial port listing, JSONL request forwarding, and selected binary firmware flash execution.
- Web UI includes a hardware console panel with Web Serial, Desktop native proxy, Wi-Fi HTTP fallback, Wi-Fi provisioning controls, firmware flashing, and console logs.

## Coverage

- Firmware USB JSONL: implemented for `info`, `ports.get`, `port.power_set`, `port.replug`, `wifi.get`, `wifi.set`, `wifi.clear`, and `reboot`.
- Firmware Wi-Fi HTTP fallback: implemented for `info`, `ports.get`, port power/replug actions, `wifi.get`, `wifi.set`, `wifi.clear`, and `reboot`.
- EEPROM Wi-Fi config: implemented with magic/version/checksum record, SSID/PSK fields, optional static IPv4 fields, and queued runtime writes through the telemetry I2C bus.
- Desktop native proxy: implemented for serial enumeration, JSONL request proxying, single-operation serial lock, and `espflash write-bin` execution using the user-selected `.bin` and port path.
- Web transports and hardware console UI: implemented with Web Serial JSONL, native proxy JSONL, Wi-Fi HTTP fallback, and `esptool-js` browser flashing of a selected `.bin`.
- Storybook and visual evidence: implemented for disconnected, connected, flashing, Wi-Fi configured, Wi-Fi error, and offline fallback states.

## Validation

- `cargo build --release --features net_http`
- `cd web && bun run check`
- `cd web && bun run build`
- `cd web && bun run build-storybook`
- `cd desktop/src-tauri && cargo check`
- Storybook visual evidence captured from `Panels/HardwareConsolePanel / ConnectedNativeProxy` at desktop and mobile viewports.
