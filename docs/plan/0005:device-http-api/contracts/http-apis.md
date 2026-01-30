# HTTP APIs（`/api/v1`）

本文件定义“设备（固件）↔ Web”的 HTTP API 契约。所有接口均要求 **可实现、可测试**，并可在后续计划中增量扩展。

## 0. 通用约定（Common）

### Base URL

- `baseUrl = http://<hostname>.local`（mDNS）或 `http://<ipv4>`（直连）
- API 前缀：`/api/v1`

### Content types

- 请求：`GET/OPTIONS` 无 body；`POST` 默认无 body（用 path/query 传参）。
- 响应：`Content-Type: application/json; charset=utf-8`
- 建议：`Cache-Control: no-store`

### Auth

- `none`（已确认；如需加固另开 Plan 并修改此处）

### 标准错误返回（Error envelope）

所有非 2xx 响应使用统一 JSON：

```json
{
  "error": {
    "code": "busy",
    "message": "port is busy",
    "retryable": true
  }
}
```

- `code`（固定枚举）：
  - `bad_request`（400）
  - `invalid_port`（404）
  - `not_supported`（501）
  - `busy`（409）
  - `internal_error`（500）
- `retryable`：`busy`/`temporarily_unavailable` 这类返回 `true`；其余一般为 `false`。

### CORS + Private Network Access（PNA）

目标：允许 GitHub Pages（HTTPS）访问局域网设备（HTTP）。

设备端要求：

- 对所有 `/api/v1/*` 的响应（含错误）返回 CORS headers（至少 `Access-Control-Allow-Origin`，并建议 `Vary: Origin`）。
- 支持 `OPTIONS` 预检请求。
- 当预检请求包含 `Access-Control-Request-Private-Network: true` 时，预检响应必须包含：
  - `Access-Control-Allow-Private-Network: true`
  - `Private-Network-Access-ID: <aa:bb:cc:dd:ee:ff>`（建议用设备 MAC）
  - `Private-Network-Access-Name: <isolapurr-usb-hub-aabbcc>`（建议用 hostname/设备名；仅用 `[a-z0-9_-.]`）

> 说明：以上 `Private-Network-Access-*` 头用于 Chrome 的 Private Network Access permission prompt（以目标 Chrome 版本行为为准）。

#### Allowed origins（冻结）

- 线上：仅允许 `https://isolapurr.ivanli.cc`
- 本地 dev：允许对 `http://localhost:*` 与 `http://127.0.0.1:*` 反射 `Origin`

Web 端建议：

- `fetch()` 访问 `http://` 设备时设置 `targetAddressSpace: "private"`（Chrome/Chromium）以触发 PNA 流程与权限提示（具体以浏览器实测为准）。

## 1. Health（`GET /api/v1/health`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 请求（Request）

- Headers: `Origin`（跨域时浏览器自动带）

### 响应（Response）

- Success（200）:

```json
{ "ok": true }
```

- Error：见“标准错误返回”

## 2. Device info（`GET /api/v1/info`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 响应（Response）

- Success（200）:

```json
{
  "device": {
    "device_id": "aabbcc",
    "hostname": "isolapurr-usb-hub-aabbcc",
    "fqdn": "isolapurr-usb-hub-aabbcc.local",
    "mac": "aa:bb:cc:dd:ee:ff",
    "variant": "tps-sw",
    "firmware": { "name": "isolapurr-usb-hub", "version": "0.1.0" },
    "uptime_ms": 123456,
    "wifi": { "state": "connected", "ipv4": "192.168.1.42", "is_static": false }
  }
}
```

### 错误（Errors）

- 500: `internal_error`（retryable: yes）

## 3. Ports list（`GET /api/v1/ports`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 响应（Response）

#### Success（200）

```json
{
  "hub": { "upstream_connected": true },
  "ports": [
    {
      "portId": "port_a",
      "label": "USB-A",
      "telemetry": {
        "status": "ok",
        "voltage_mv": 5000,
        "current_ma": 120,
        "power_mw": 600,
        "sample_uptime_ms": 123450
      },
      "state": {
        "power_enabled": true,
        "data_connected": true,
        "replugging": false,
        "busy": false
      },
      "capabilities": { "data_replug": true, "power_set": true }
    }
  ]
}
```

字段说明：

- `hub.upstream_connected`：Hub 侧的“上游链路指示”状态位（是否检测到与上游主机的连接）。
  - tps-sw：该字段来自 `CH318T U2 LED/MODE(LEDD)` 节点（MCU `GPIO6` 高阻采样，active-low），固件对输入做稳定化（去抖）后输出 1-bit 状态。
  - 说明：tps-sw 上 `LEDD` 同时承担模式下拉（`R9=5.1kΩ→GND`）与板载 LED 网络（`R8=1kΩ→LED1→3V3`），但该节点仍会被 CH318 主动驱动；固件只读取，不加载、不驱动。

#### Telemetry status

- `status`（枚举）：
  - `ok`
  - `not_inserted`（端口未插入/未激活；数值字段应为 `null`）
  - `error`（采样/计算失败；数值字段应为 `null`）
  - `overrange`（超量程；数值字段可为 `null`，或返回被截断的数值但必须将 `status` 置为 `overrange`）

数值字段约定：

- 当 `status != "ok"` 时：`voltage_mv/current_ma/power_mw` 必须为 `null`（避免“看似有效但其实不可用”的假数值）。

### 错误（Errors）

- 500: `internal_error`（retryable: yes）

## 4. Port details（`GET /api/v1/ports/{portId}`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 路径参数

- `portId`: `port_a | port_c`

### 响应（Response）

- Success（200）：返回单个 port 对象（形状同 `GET /api/v1/ports` 的数组元素）
- Errors：
  - 404: `invalid_port`（retryable: no）

## 5. Data replug（`POST /api/v1/ports/{portId}/actions/replug`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 请求（Request）

- Body: none

### 响应（Response）

- Success（202）:

```json
{ "accepted": true }
```

### 错误（Errors）

- 404: `invalid_port`（retryable: no）
- 409: `busy`（retryable: yes）
- 501: `not_supported`（retryable: no）

## 6. Power set（`POST /api/v1/ports/{portId}/power?enabled={0|1}`）

- 范围（Scope）: external
- 变更（Change）: New
- 鉴权（Auth）: none

### 请求（Request）

- Query:
  - `enabled`: `0`（off）或 `1`（on），必填
- Body: none

### 响应（Response）

- Success（200）:

```json
{ "accepted": true, "power_enabled": true }
```

### 错误（Errors）

- 400: `bad_request`（enabled 缺失或非法；retryable: no）
- 404: `invalid_port`（retryable: no）
- 409: `busy`（retryable: yes）
- 501: `not_supported`（retryable: no）

## 7. Preflight（`OPTIONS /api/v1/*`）

> 这是行为约定，不是业务 endpoint。对任一具体 path 的预检请求应得到一致响应。

### 请求（Request）

常见请求头：

- `Origin: https://isolapurr.ivanli.cc`
- `Access-Control-Request-Method: GET|POST`
- `Access-Control-Request-Headers: ...`（可能为空）
- `Access-Control-Request-Private-Network: true`（PNA 场景）

### 响应（Response）

- Status: `204 No Content`
- Headers（示例；具体 allowlist 规则由实现决定，但必须满足浏览器预检要求）：
  - `Access-Control-Allow-Origin: <echo Origin>`
  - `Vary: Origin`
  - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
  - `Access-Control-Allow-Headers: <echo requested headers or a safe subset>`
  - `Access-Control-Allow-Private-Network: true`（当请求包含 `Access-Control-Request-Private-Network: true` 时必须返回）
  - `Private-Network-Access-ID: aa:bb:cc:dd:ee:ff`（同上）
  - `Private-Network-Access-Name: isolapurr-usb-hub-aabbcc`（同上）
