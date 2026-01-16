# HTTP APIs（Desktop local agent）

本计划仅修改既有 endpoint：`GET /api/v1/discovery/snapshot`。

## Discovery snapshot（GET /api/v1/discovery/snapshot）

- 范围（Scope）: external
- 变更（Change）: Modify
- 鉴权（Auth）: Bearer token

### 请求（Request）

- Headers: `Authorization: Bearer <token>`
- Query: none
- Body: none

### 响应（Response）

- Success: `DiscoverySnapshot`

新增字段（在 `ipScan` 下）：

```json
{
  "mode": "service",
  "status": "ready",
  "devices": [],
  "ipScan": {
    "expanded": false,
    "expandedBy": "user",
    "autoExpandAfterMs": 30000,
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

- 401: `unauthorized`
- 403: `forbidden`
- 500: `internal_error`

### 兼容性与迁移（Compatibility / migration）

- 变更为**向后兼容的字段新增**；旧客户端应忽略未知字段。
- 当 `defaultCidr` 缺失或 `candidates` 为空时，UI 必须保持空输入并提示用户手动输入。
