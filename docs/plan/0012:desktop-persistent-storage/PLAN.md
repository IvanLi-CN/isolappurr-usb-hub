# Desktop：本地持久化记忆（不依赖浏览器存储）（#0012）

## 状态

- Status: 待实现
- Created: 2026-01-16
- Last: 2026-01-16

## 背景 / 问题陈述

- Desktop App 当前复用 Web UI 的 `localStorage` 来保存“已添加设备/部分设置”；当 `origin` 变化（例如 localhost 端口变化）或 WebView/系统浏览器存储被清理时，会导致设备列表/设置丢失。
- 对桌面客户端而言，这类“记忆”应归属 App 自己的本地持久化（OS 标准应用数据目录），与浏览器 profile 解耦。

## 目标 / 非目标

### Goals

- Desktop App 的“已添加设备列表”在 App 自己的本地存储中持久化（不依赖 `localStorage` / Cookie / 浏览器 Profile）。
- 设备列表在 `gui` / `tray` / `open` / `serve` 各模式下保持一致，跨重启保留。
- 与现有 Web UI 交互保持一致：Create 后立刻出现在 Devices 列表；可删除；重复添加有校验。
- 为后续扩展更多“桌面端设置”（例如主题/最近使用）提供明确的数据边界与接口边界。

### Non-goals

- 不做云端同步/账号体系。
- 不把“Auto discovery 候选列表”做持久化（候选应实时发现）。
- 不在本计划引入设备鉴权/加密通信（仅本地存储，不含敏感凭据）。
- 不改固件侧行为。

## 用户与场景（Users & Scenarios）

- macOS 桌面用户（首发）；Windows/Linux 由 Plan #0009 继续推进。
- 场景 A：用户添加设备后关闭 App，再次打开仍能看到设备列表。
- 场景 B：用户从 tray 模式切到 gui 模式，设备列表一致。
- 场景 C：localhost 端口变化/被占用导致换端口，设备列表仍存在（不受 `origin` 变化影响）。

## 范围（Scope）

### In scope

- Desktop local agent 增加“存储”能力：
  - 在 OS 标准应用数据目录持久化设备列表与桌面端设置（首批至少 theme）。
  - 提供受 `Authorization: Bearer <token>` 保护的 localhost HTTP API 供同源 UI 调用。
- Web UI 引入“存储适配层”：
  - 当检测到 Desktop agent（`GET /api/v1/bootstrap` 成功）时，设备列表与设置读写改为调用 agent storage API。
  - 远程 Web（GitHub Pages）仍沿用 `localStorage`（不要求引入新的后端）。
- 一次性迁移策略（Desktop 场景）：
  - 当 Desktop storage 为空且检测到 `localStorage` 旧数据时，执行一次导入；导入成功后不再依赖 `localStorage`。
- 可靠性与自愈：
  - 存储损坏/JSON 解析失败时不阻塞 App 启动；UI 可展示可理解错误，并提供“重置本地数据”入口。
- 观测：
  - 迁移/读写失败有日志；不得打印 token。

### Out of scope

- 本地加密/密钥管理（本计划默认不加密，且不存储敏感凭据）。
- 与设备通信相关的鉴权/加密（仍按现状）。
- 自动发现候选与扫描状态的持久化。

## 需求（Requirements）

### MUST

- Desktop agent 提供“设备列表存储”的读写接口（同源 localhost UI 调用，受 token 保护）。
- 持久化数据存储在 OS 标准应用数据目录（`directories::ProjectDirs`），不依赖浏览器存储。
- 支持基本 CRUD 语义：
  - 列表读取
  - 添加/更新（优先使用 `device_id` 作为逻辑主键；缺失时以 `baseUrl` 去重/定位更新目标）
  - 删除
- 首次启用时提供迁移策略：
  - 当 Desktop storage 为空且存在旧 `localStorage` 存量时，Desktop 可做一次性导入（导入成功后不再依赖 `localStorage`）。
- 数据校验与去重规则与 Web 保持一致（URL 校验/normalize、ID 校验、重复添加阻止）。

### SHOULD

- 支持导出/导入（JSON）以便迁移机器或排障。
- 支持存储“用户设置”（至少 theme），同样不依赖浏览器存储。（本计划纳入实现范围）

### COULD

- 版本化存储格式（`schema_version`）以便未来升级迁移。
- 写入采用原子方式（写临时文件再 `rename`）避免崩溃导致损坏。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop storage APIs（`/api/v1/storage/*`） | HTTP API | external | New | ./contracts/http-apis.md | Desktop | Web UI（Desktop 模式） | token + origin 限制复用既有规则 |
| Desktop storage file（`storage.json`） | File format | internal | New | ./contracts/file-formats.md | Desktop | Desktop agent | 位于 `ProjectDirs` 下；需自愈/备份策略 |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/http-apis.md](./contracts/http-apis.md)
- [contracts/file-formats.md](./contracts/file-formats.md)

## 验收标准（Acceptance Criteria）

### Core path

- Given：用户在 Desktop App 中添加了设备  
  When：关闭并重新打开 App  
  Then：Devices 列表仍包含该设备（跨重启保留）。
- Given：agent 端口从一个值变为另一个值（例如因占用而换端口）  
  When：重新打开 UI  
  Then：Devices 列表仍存在（不受 `origin` 变化影响）。
- Given：在 tray 模式下添加设备  
  When：切到 gui 模式打开 UI  
  Then：设备列表一致。

- Given：Desktop storage 为空，且 Web UI 在当前 origin 的 `localStorage` 存在旧设备列表/主题设置  
  When：首次启动 Desktop App 并打开 UI  
  Then：自动执行一次迁移，并在 UI 中提示“已从浏览器存储导入”（不阻塞后续操作）。

### Edge cases

- Given：存储文件损坏或 JSON 解析失败  
  When：启动 App 并打开 UI  
  Then：App 仍可启动；UI 有可理解提示；且“重置本地数据”可恢复到可用状态（不阻塞 Manual add）。
- Given：`device_id` 缺失  
  When：用户重复以同一 `baseUrl` 添加  
  Then：重复添加被阻止（或被识别为更新同一条记录，按契约一致）。
- Given：迁移已执行过一次  
  When：再次启动 Desktop App  
  Then：不会反复导入导致重复；迁移入口可报告“已迁移/无需迁移”的状态。

## 非功能性验收 / 质量门槛（Quality Gates）

### Performance

- 典型规模（几十条设备）下：读取/写入本地文件应在 50ms 量级（不要求严格基准，但需避免明显卡顿）。

### Reliability

- 存储损坏不影响 App 启动；应有回退/自愈策略（例如备份损坏文件并初始化空存储）。
- 写入尽量采用原子路径（同目录临时文件 → `rename`）。

### Security / Privacy

- 存储内容仅包含用户显式添加的设备地址与展示信息；不存储敏感凭据。
- HTTP API 仍需 `Authorization: Bearer <token>`；不启用跨域 CORS；仅监听 loopback（`127.0.0.1`/`::1`）。
- 日志不得打印 token。

### Testing（不引入新工具）

- Desktop：`cd desktop/src-tauri && cargo test`（新增覆盖：存储读写/迁移/损坏自愈/HTTP handler 基本路径）。
- Web：`cd web && bun run check && bun run build`（确保远程 Web 路径仍可用）。

## Milestones

- [ ] M1: 定义 on-disk 存储格式（含 `schema_version`、devices、settings）与损坏回退策略
- [ ] M2: Desktop agent 实现 `/api/v1/storage/*`（CRUD + export/import + migrate + reset）
- [ ] M3: Web UI 引入存储适配层（Desktop → agent storage；Web → localStorage），并完成一次性迁移
- [ ] M4: UX：错误提示与“重置本地数据”入口；日志口径冻结（不泄露 token）
- [ ] M5: 补齐 tests/quality gates 覆盖关键边界（尤其迁移与损坏场景）

## 约束与风险（Constraints & Risks）

- 远程 Web（GitHub Pages）必须继续可用：不能依赖 Desktop API 才能运行；Desktop-only 能力必须可降级回 `localStorage`。
- Windows/Linux（Plan #0009）后续接入时需关注目录差异与文件权限；避免 macOS-only 实现。
- “迁移自动化”与“用户可控”存在取舍：自动迁移可减少丢失，但也可能引入不可见副作用（例如清空 localStorage）。

## 开放问题（需要主人决策）

None

## 假设（Assumptions，需主人确认）

- 本需求的“记忆功能”至少包含“已添加设备列表”，且优先级最高。
- 本计划不做加密存储；仅普通本地 JSON（或等价结构化存储），且不包含敏感凭据。
- Storage HTTP API 采用“逐条 upsert + delete”形态（不提供全量覆盖作为主路径）。
- theme 偏好纳入 Desktop storage，并在 Desktop 首次启动时随 devices 一并自动迁移（迁移后 UI 不再依赖 `localStorage` 作为 Desktop 模式数据源）。
