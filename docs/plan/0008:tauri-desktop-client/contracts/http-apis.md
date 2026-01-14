# HTTP APIs（Desktop local agent）

本文件定义“Desktop 本机程序 ↔ 系统浏览器中的本地 UI”的 HTTP 接口契约。

目标：

- 为本地 UI 提供 discovery（mDNS/DNS‑SD + IP scan）能力
- 约束访问边界：**localhost only** + token（避免外部网站触发扫描/刷新）

## 0. 通用约定（Common）

### Base URL

- `agentBaseUrl = http://127.0.0.1:<port>`（或 `http://[::1]:<port>`）
- `<port>`：高位端口；未指定时允许自动选择（并应尽量保持稳定）：
  - 若用户通过 `--port` 指定：使用该端口；端口被占用则启动失败（避免“用户以为是 A 端口但实际跑在 B 端口”）。
  - 若未指定：优先复用上一次成功启动的端口；否则从默认范围 `51200–51299` 中选择一个可用端口并持久化保存。
  - 最终值以 `GET /api/v1/bootstrap` 返回的 `agentBaseUrl` 为准。

### Content types

- 请求：`Content-Type: application/json; charset=utf-8`（仅对 `POST` 要求）
- 响应：`Content-Type: application/json; charset=utf-8`
- 建议：`Cache-Control: no-store`

### Auth（token）

- 除 `GET /api/v1/bootstrap` 外，所有 `/api/v1/*` 必须携带：
  - `Authorization: Bearer <token>`
- `token` 由 agent 在启动时生成（每次启动变化），用于阻止外部网站/未知页面对 localhost API 发起“有副作用”的请求（例如触发扫描/刷新）。
  - 备注：这是 **Desktop local agent 的会话 token**（防滥用/防 CSRF 思路），不是“设备鉴权/用户登录”，也不会发送到局域网设备上。

### CORS / Origin

- 默认 **不启用跨域 CORS**（本地 UI 与 API 同源，不需要 CORS）。
- 对携带 `Origin` 的请求：
  - 若 `Origin` 不属于允许集合（例如 `agentBaseUrl` 或等价形式 `http://localhost:<port>`），应拒绝（401/403）。

### 标准错误返回（Error envelope）

所有非 2xx 响应使用统一 JSON：

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

- `unauthorized`（401）
- `forbidden`（403）
- `bad_request`（400）
- `temporarily_unavailable`（503，retryable: yes）
- `internal_error`（500）

## 1. Bootstrap（`GET /api/v1/bootstrap`）

> 用于 UI 获取 token 与运行信息（无需 token）。

- Scope: external
- Change: New
- Auth: none

### Response（200）

```json
{
  "token": "base64url-or-opaque-string",
  "agentBaseUrl": "http://127.0.0.1:51234",
  "app": {
    "name": "isolapurr-desktop",
    "version": "0.0.0",
    "mode": "gui"
  }
}
```

## 2. Health（`GET /api/v1/health`）

- Scope: external
- Change: New
- Auth: Bearer token

### Response（200）

```json
{ "ok": true }
```

## 3. Discovery snapshot（`GET /api/v1/discovery/snapshot`）

> 返回 UI 需要的完整状态快照。`snapshot` shape 应与 Plan #0007 的 `DiscoverySnapshot` 对齐。

- Scope: external
- Change: New
- Auth: Bearer token

### Response（200）

```json
{
  "mode": "service",
  "status": "scanning",
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

## 4. Discovery refresh（`POST /api/v1/discovery/refresh`）

触发一次 mDNS/DNS‑SD 刷新（实现细节见 Plan #0008）。

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{}
```

### Response（202）

```json
{ "accepted": true }
```

## 5. Discovery IP scan（`POST /api/v1/discovery/ip-scan`）

> Fallback：用户显式输入 CIDR 后才调用；不得自动猜测网段。

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{ "cidr": "192.168.1.0/24" }
```

### Response（202）

```json
{ "accepted": true }
```

### Errors

- 400: `bad_request`（invalid cidr）
- 503: `temporarily_unavailable`
- 500: `internal_error`
