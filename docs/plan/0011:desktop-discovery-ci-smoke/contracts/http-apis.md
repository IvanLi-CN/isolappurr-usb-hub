# HTTP API（Plan #0011 增量）

本计划默认复用 Plan #0008 的 Desktop local HTTP APIs，并补齐 discovery “不可用/降级”时的可诊断语义。

## Discovery snapshot（GET /api/v1/discovery/snapshot）

- 范围（Scope）: external
- 变更（Change）: Modify
- 鉴权（Auth）: Bearer token（同 Plan #0008；仅 localhost）

### 请求（Request）

- Headers:
  - `Authorization: Bearer <token>`
  - `Origin: http://127.0.0.1:<port>`（或 `localhost/::1`；否则拒绝）
- Query: None
- Body: None

### 响应（Response）

- Success: `200 application/json`

Schema（概念性；字段以现有实现为准）：

```json
{
  "mode": "service|scan",
  "status": "idle|scanning|ready|unavailable",
  "devices": [
    {
      "baseUrl": "http://127.0.0.1:1234",
      "device_id": "optional",
      "hostname": "optional",
      "fqdn": "optional",
      "ipv4": "optional",
      "variant": "optional",
      "firmware": { "name": "isolapurr-usb-hub", "version": "..." },
      "last_seen_at": "RFC3339"
    }
  ],
  "error": "optional",
  "scan": { "cidr": "x.x.x.x/yy", "done": 0, "total": 256 }
}
```

### 语义补齐（本计划新增/冻结）

- 当 mDNS 后端不可用（初始化失败 / browse 失败 / 被显式禁用）时：
  - `status` MUST 为 `unavailable`
  - `error` MUST 为非空可读字符串（包含原因与建议，例如“mDNS unavailable: check firewall/permissions; use IP scan/manual add”）
  - agent 其它 API 仍可响应（例如 IP scan 相关端点）

### 错误（Errors）

- `401 unauthorized`: missing/invalid bearer token
- `403 forbidden`: origin not allowed

### 示例（Examples）

- Response（mDNS 不可用时）:
  - `status: "unavailable"`
  - `error: "mDNS unavailable: ... (use IP scan or manual add)"`

### 兼容性与迁移（Compatibility / migration）

- 本计划不改变 `devices[*]` 的字段形状；仅冻结 `unavailable` 时 `error` 必须可读且非空。

