# USB 通信、固件更新与 Wi-Fi provisioning

## Background

IsolaPurr USB Hub 需要在同一套 Web / Desktop 控制台里支持三类连接路径：

- Wi-Fi / HTTP：产品已联网时，Web App 可通过局域网连接 Hub。
- USB / Web Serial：浏览器支持 Web Serial 时，可通过 ESP32-S3 USB Serial/JTAG CDC-ACM 与 Hub 通信。
- Desktop native proxy：桌面 App 提供本机串口、烧录与代理能力，用于补足浏览器能力缺口。

旧文档来源：

- `docs/plan/0003:wifi-mdns-http/PLAN.md`
- `docs/plan/0005:device-http-api/PLAN.md`
- `docs/plan/0008:tauri-desktop-client/PLAN.md`
- `docs/plan/0012:desktop-persistent-storage/PLAN.md`

## Goals

- 统一设备通信协议：USB CDC-ACM 与 native proxy 使用 JSONL request/response/event，字段尽量复用 HTTP API shape。
- 支持产品固件更新：Web Serial 使用浏览器能力，Desktop native proxy 使用本机能力；UI 以“固件更新”呈现，不暴露内部开发调试口径。
- Wi-Fi 运行时配置：SSID/PSK 不再作为编译期必填项，凭据保存到板载 EEPROM U21 `M24C64-FMC6TG`，7-bit 地址 `0x50`。
- 产品控制台：Web App 同时表达 Wi-Fi、USB、Desktop native 三条连接路径，并提供遥测、Wi-Fi 配置、端口控制和日志/进度状态。

## Non-goals

- 不实现 TinyUSB 自定义 USB device、MSC/HID/composite device。
- 不实现多设备批量烧录、云同步、账号体系或远程 OTA。
- 不把 Web Serial 视为所有浏览器都可用；不支持时必须展示 fallback。

## Requirements

- Firmware MUST expose a JSONL protocol over ESP32-S3 USB Serial/JTAG CDC-ACM.
- Firmware MUST accept at least these commands: `info`, `ports.get`, `port.power_set`, `port.replug`, `wifi.get`, `wifi.set`, `wifi.clear`, `reboot`.
- Firmware MUST load Wi-Fi credentials from EEPROM at boot. If no credentials exist, networking remains unconfigured while USB provisioning remains available.
- Firmware MUST remove `USB_HUB_WIFI_SSID` and `USB_HUB_WIFI_PSK` as build-time required inputs.
- EEPROM storage MUST include a magic/version marker and checksum or equivalent corruption guard.
- Desktop agent MUST expose token-protected localhost APIs for serial port listing, command proxying, and firmware update operations.
- Web UI MUST provide clear states for unsupported Web Serial, no device, connected, flashing/updating, update failed, Wi-Fi empty/configured/error, telemetry online/offline, busy action, and disruptive action confirmation.
- Storybook MUST cover the new hardware console states before visual evidence is accepted.

## JSONL Protocol

Each host request is one UTF-8 JSON object followed by `\n`.

```json
{"id":"1","method":"info"}
```

Each response includes the same `id` when available:

```json
{"id":"1","ok":true,"result":{}}
```

Errors use:

```json
{"id":"1","ok":false,"error":{"code":"bad_request","message":"invalid request","retryable":false}}
```

Events omit `id` and include `event`:

```json
{"event":"log","message":"wifi credentials saved"}
```

## Wi-Fi EEPROM Format

EEPROM U21 is `M24C64-FMC6TG` on I2C1 `SDA/SCL`, address `0x50`.

The stored record contains:

- magic/version
- SSID
- PSK
- optional hostname/static IPv4 fields
- checksum

The product UI should label writes as Wi-Fi configuration. After a successful `wifi.set`, the firmware may require reboot before Wi-Fi reconnects with the new settings.

## UI Design Brief

This is a product control console for hardware and embedded engineers using IsolaPurr USB Hub in their own bench workflow.

- Color strategy: Restrained.
- Scene: an engineer at a desk with the Hub physically connected, focused on connection state, update progress, port behavior, and power telemetry.
- Layout: connection/update strip first; telemetry and port controls primary; Wi-Fi configuration, serial/native status, logs and progress secondary.
- Tone: dense, calm, precise, instrument-like.

## Acceptance Criteria

- Given no build-time `USB_HUB_WIFI_SSID` or `USB_HUB_WIFI_PSK`, when building with `net_http`, then firmware compile does not fail because of missing Wi-Fi credentials.
- Given EEPROM contains valid Wi-Fi credentials, when firmware boots with `net_http`, then Wi-Fi uses the stored credentials.
- Given a browser with Web Serial support, when the user connects over USB, then the app can fetch info/ports and run supported controls via JSONL.
- Given Web Serial is unsupported, when the user opens the console, then the UI offers Desktop/native or Wi-Fi/HTTP alternatives.
- Given the Desktop agent is running, when the user lists serial ports or proxies a command, then requests require the existing bearer token and origin policy.
- Given UI changes are complete, when Storybook renders the console states, then desktop and mobile evidence show no text overlap, clipping, or incoherent layout.

## Visual Evidence

Evidence source: Storybook canvas, `Panels/HardwareConsolePanel / ConnectedNativeProxy`, captured from this worktree implementation.

Desktop viewport:

![Hardware console desktop](assets/hardware-console-desktop.png)

Mobile viewport:

![Hardware console mobile](assets/hardware-console-mobile.png)
