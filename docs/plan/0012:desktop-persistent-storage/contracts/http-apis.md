# HTTP APIs（Desktop local agent storage）（#0012）

本文件定义 Desktop local agent 提供的“本地持久化存储”接口契约：用于同源 UI 在 Desktop 模式下读写“已添加设备列表/桌面端设置”。

## 0. 通用约定（Common）

复用 Plan #0008 的约定（baseUrl、token、origin 限制、错误 envelope）。本文件只定义新增 `/api/v1/storage/*` 路径的 request/response shape 与语义。

### Auth / Origin

- 除非特别说明，所有接口：
  - Auth: `Authorization: Bearer <token>`
  - Origin: 必须通过现有 `origin` allowlist（`127.0.0.1` / `localhost` / `::1` + 同端口）校验

### Error envelope

沿用：

```json
{
  "error": {
    "code": "bad_request",
    "message": "invalid baseUrl",
    "retryable": false
  }
}
```

建议补充 `code`：

- `conflict`（409，例如重复添加）
- `not_found`（404）

## 1. List devices（`GET /api/v1/storage/devices`）

- Scope: external
- Change: New
- Auth: Bearer token

### Response（200）

```json
{
  "devices": [
    {
      "id": "aabbcc",
      "name": "Desk Hub",
      "baseUrl": "http://192.168.1.23",
      "lastSeenAt": "2026-01-13T02:30:12Z"
    }
  ]
}
```

Notes:

- `baseUrl` 必须是 normalize 后的 `url.origin`（与 Web 的 `normalizeBaseUrl` 一致）。
- `lastSeenAt` 是可选字段；本计划不强制写入，但保留兼容位。

## 2. Upsert device（`POST /api/v1/storage/devices`）

> 默认采用“逐条 upsert”形态（若主人选择“全量覆盖”，在实现阶段将本条替换为 `PUT /api/v1/storage/devices` 的契约，并保留兼容策略）。

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{
  "device": {
    "id": "aabbcc",
    "name": "Desk Hub",
    "baseUrl": "http://192.168.1.23"
  }
}
```

Semantics:

- 校验：
  - `name`: non-empty after trim
  - `baseUrl`: must be a valid `http(s)` URL; stored as `origin`
  - `id`: optional；若提供必须 non-empty after trim
- 去重/定位规则（逻辑主键）：
  - 若 `id` 提供：以 `id` 定位并更新；若已存在且 `baseUrl` 冲突 → 409 `conflict`
  - 若 `id` 缺失：以 `baseUrl` 定位并更新（保持原 `id` 不变）；若不存在则创建新记录并生成 `id`

### Response（200）

```json
{
  "device": {
    "id": "aabbcc",
    "name": "Desk Hub",
    "baseUrl": "http://192.168.1.23"
  }
}
```

### Errors

- 400: `bad_request`（字段校验失败）
- 409: `conflict`（重复添加或 key 冲突）
- 500: `internal_error`

## 3. Delete device（`DELETE /api/v1/storage/devices/{id}`）

- Scope: external
- Change: New
- Auth: Bearer token

### Response

- 200:

```json
{ "deleted": true }
```

- 404: `not_found`

## 4. Get settings（`GET /api/v1/storage/settings`）

- Scope: external
- Change: New
- Auth: Bearer token

### Response（200）

```json
{
  "settings": {
    "theme": "system"
  }
}
```

Notes:

- `theme` 值域与 Web 保持一致（见 Plan #0006）。

## 5. Update settings（`PUT /api/v1/storage/settings`）

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{
  "settings": {
    "theme": "isolapurr-dark"
  }
}
```

### Response（200）

```json
{
  "settings": {
    "theme": "isolapurr-dark"
  }
}
```

### Errors

- 400: `bad_request`（theme 非法）

## 6. Migrate from localStorage（`POST /api/v1/storage/migrate/localstorage`）

> 迁移触发由 UI 侧完成：UI 读取旧 `localStorage` key（devices/theme），将数据提交给 agent；agent 仅负责校验、去重与落盘。

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{
  "source": "localStorage",
  "devices": [
    { "id": "demo", "name": "Demo Hub", "baseUrl": "http://192.168.1.23" }
  ],
  "settings": { "theme": "system" }
}
```

Semantics:

- 仅在 Desktop storage “当前为空”时执行导入（避免反复迁移造成重复/覆盖）。
- 导入过程中应用与新增设备相同的校验与去重规则。
- 预期调用时机：UI 在 Desktop 模式启动后自动触发（并向用户展示“已导入”的提示）。

### Response（200）

```json
{
  "migrated": true,
  "imported": { "devices": 1, "settings": true }
}
```

### Response（200，已迁移/无需迁移）

```json
{
  "migrated": false,
  "reason": "already_initialized"
}
```

## 7. Export storage（`GET /api/v1/storage/export`）

- Scope: external
- Change: New
- Auth: Bearer token

### Response（200）

返回 `contracts/file-formats.md` 中定义的完整存储对象（用于导出/排障）：

```json
{
  "schema_version": 1,
  "devices": [],
  "settings": { "theme": "system" },
  "meta": { "migrated_from_localstorage_at": "2026-01-16T00:00:00Z" }
}
```

## 8. Import storage（`POST /api/v1/storage/import`）

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{
  "storage": {
    "schema_version": 1,
    "devices": [],
    "settings": { "theme": "system" }
  },
  "mode": "merge"
}
```

Semantics:

- `mode`：
  - `merge`：按 upsert 规则合并 devices；settings 以请求值覆盖已存在字段（未知字段忽略或保留由实现决定，需在实现阶段冻结）
  - `replace`：完全覆盖现有存储（高风险；需明确确认）

### Response（200）

```json
{ "imported": true }
```

## 9. Reset storage（`POST /api/v1/storage/reset`）

> UI 的“重置本地数据”入口使用；不应阻塞 app 启动。

- Scope: external
- Change: New
- Auth: Bearer token

### Request

```json
{}
```

### Response（200）

```json
{ "reset": true }
```
