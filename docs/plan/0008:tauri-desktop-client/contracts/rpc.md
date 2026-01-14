# RPC（Tauri IPC Commands）

本文件定义 “Desktop App 前端（WebView）↔ Tauri Rust 后端” 的 IPC 契约，用于提供局域网 discovery（mDNS/DNS‑SD 主路径）与 IP scan（fallback）。

> 说明：
>
> - Desktop local HTTP API（见 `http-apis.md`）是 **MUST**，用于系统浏览器 UI。
> - 本 RPC 为 **可选**：当 GUI 选择走 IPC（而不是走 localhost HTTP）时使用。
> - 为减少前端分支，本 RPC 的返回 shape **应与 `http-apis.md` 对齐**，并尽量复用 Plan #0007 的领域形状（`DiscoveredDevice` / `DiscoverySnapshot`）。

## `discovery_health`

- Scope: internal
- Change: New

### Response（success）

```json
{ "ok": true }
```

## `discovery_refresh`

触发一次 mDNS/DNS‑SD 刷新（实现细节见 Plan #0008 方案概述）。

- Scope: internal
- Change: New

### Request

```json
{}
```

### Response（success）

```json
{ "accepted": true }
```

## `discovery_list_devices`

- Scope: internal
- Change: New

### Response（success）

```json
{
  "devices": [
    {
      "baseUrl": "http://isolapurr-usb-hub-aabbcc.local",
      "device_id": "aabbcc",
      "hostname": "isolapurr-usb-hub-aabbcc",
      "fqdn": "isolapurr-usb-hub-aabbcc.local",
      "ipv4": "192.168.1.42",
      "variant": "tps-sw",
      "firmware": { "name": "isolapurr-usb-hub", "version": "0.1.0" },
      "last_seen_at": "2026-01-13T02:30:12Z"
    }
  ]
}
```

## `discovery_ip_scan`

> Fallback：用户显式输入 CIDR 后才调用；不得自动猜测网段。

- Scope: internal
- Change: New

### Request

```json
{ "cidr": "192.168.1.0/24" }
```

### Response（success）

```json
{ "accepted": true }
```

### Errors（统一 envelope，示例）

```json
{
  "error": {
    "code": "bad_request",
    "message": "invalid cidr",
    "retryable": false
  }
}
```

建议 `code`（可扩展）：

- `temporarily_unavailable`（retryable: yes）
- `bad_request`（retryable: no）
- `internal_error`（retryable: maybe）

## 进度推送（可选，Channel）

如需更顺滑体验，可为 `discovery_refresh` / `discovery_ip_scan` 增加一个 channel 参数向前端推送事件：

- `started`
- `progress`（包含已探测/总量或“未知总量”的计数）
- `finished`

事件 payload shape 在实现阶段冻结；若不做推送，则前端以轮询 `discovery_list_devices` 作为替代。
