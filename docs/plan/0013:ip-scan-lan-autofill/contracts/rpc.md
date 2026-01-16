# RPC（Tauri IPC Commands）

本计划新增一个 snapshot RPC，使 GUI 模式可直接拿到完整 `DiscoverySnapshot`（与 HTTP API 保持一致）。

## `discovery_snapshot`

- 范围（Scope）: internal
- 变更（Change）: New
- 鉴权（Auth）: none（进程内 IPC）
- 超时（Timeout）: 2s
- 幂等性（Idempotency）: idempotent

### 请求（Request）

- Schema: `{}`
- Validation: none

### 响应（Response）

- Schema: `DiscoverySnapshot`（字段与 `GET /api/v1/discovery/snapshot` 对齐）

示例：

```json
{
  "mode": "service",
  "status": "ready",
  "devices": [],
  "ipScan": {
    "expanded": false,
    "defaultCidr": "192.168.1.0/24",
    "candidates": [
      {
        "cidr": "192.168.1.0/24",
        "label": "Wi-Fi (en0)",
        "interface": "en0",
        "ipv4": "192.168.1.23",
        "primary": true
      }
    ]
  }
}
```

### 错误（Errors）

- `internal_error`: 生成候选列表失败（retryable: yes）

### 兼容性与迁移（Compatibility / migration）

- GUI 若继续使用 HTTP API，可不调用此 RPC；两者 shape 必须一致。
