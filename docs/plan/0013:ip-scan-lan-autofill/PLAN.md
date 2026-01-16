# Desktop：IP scan 输入框默认填充本机局域网信息（#0013）

## 状态

- Status: 待实现
- Created: 2026-01-16
- Last: 2026-01-16

## 问题陈述（Problem Statement）

- 当前 Desktop 客户端的 Add device → IP scan（advanced）需要用户手动输入 CIDR；多数用户并不清楚本机局域网网段。
- Desktop 客户端具备读取本机网卡信息的能力，但 UI 未利用，导致扫描入口“可用但难用”。
- 需要在不触发自动扫描的前提下，降低输入门槛并保持多网卡场景可控。

## 目标 / 非目标（Goals / Non-goals）

### Goals

- Desktop 客户端在 IP scan 输入框中**默认填充**本机局域网网段（CIDR）。
- 若存在多个候选网段，输入框提供**下拉/自动完成**建议并支持切换。
- 不改变“手动触发扫描”的安全边界（仅在用户点击 Scan 后开始）。

### Non-goals

- 不为远程 Web（GitHub Pages）提供本机网段推导或自动填充。
- 不引入自动扫描、后台持续扫描或“猜测网段”。
- 不改变设备端（固件）网络行为或 mDNS 广播口径。
- 不做“上次选择记忆/持久化默认值”。

## 用户与场景（Users & Scenarios）

- 桌面用户（macOS/Windows/Linux）在同一局域网内，希望“直接点击 Scan”。
- 桌面用户同时连接 Wi‑Fi + 以太网/USB 网卡/VPN，需要选择正确的网段。
- 纯浏览器用户（远程 Web）应保持现有流程与提示，不受影响。

## 需求（Requirements）

### MUST

- Desktop 后端可返回“本机局域网候选 CIDR 列表”，并标记**默认候选**。
- 多候选时默认值固定为“系统默认路由”对应网段。
- UI 在首次渲染 IP scan 输入框时：
  - 若存在默认候选：自动填充 `defaultCidr`。
  - 若存在多个候选：提供可选建议（下拉/自动完成），并允许用户自由输入。
- “Scan” 仅在用户点击时触发；**不因默认值而自动扫描**。
- 无候选/不可用时：输入框保持空值，展示提示文案。
- 远程 Web 路径不使用本机网段推导（保持空值/示例提示）。

### SHOULD

- 候选项带有可读标签（例如 `Wi‑Fi (en0)`），便于用户判断。
- 仅提供 IPv4 私网网段（过滤 loopback / link-local / IPv6）。
- 过滤 VPN/虚拟网卡，仅保留物理网卡候选。
- 当网络环境变化时，候选列表可更新但不强制覆盖用户已编辑的输入值。
- Desktop HTTP API 与 RPC 的返回 shape 保持一致。

### COULD

- 提供“使用当前网段”的快捷动作（当候选变化时）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/v1/discovery/snapshot` | HTTP API | external | Modify | ./contracts/http-apis.md | Desktop | Desktop UI（WebView / system browser） | 增加 IP scan 候选与默认值 |
| `discovery_snapshot` | RPC | internal | New | ./contracts/rpc.md | Desktop | Tauri WebView UI | 返回与 HTTP 一致的 snapshot |
| Add device / Discovery UI shapes | UI Component | internal | Modify | ./contracts/ui-components.md | Web | Desktop UI / Web UI | 扩展 `DiscoverySnapshot.ipScan` |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/http-apis.md](./contracts/http-apis.md)
- [contracts/rpc.md](./contracts/rpc.md)
- [contracts/ui-components.md](./contracts/ui-components.md)

## 约束与风险（Constraints & Risks）

- 浏览器环境无法安全读取本机网卡信息；仅 Desktop 可用。
- 多网卡/虚拟网卡/VPN 可能导致错误默认值；需清晰提示与可切换能力。
- 若自动覆盖用户输入，可能造成“输入被抢”的体验问题。

## 验收标准（Acceptance Criteria）

- Given Desktop App 有且仅有一个私网 IPv4 网段候选
  When 打开 Add device → IP scan（advanced）输入框首次渲染
  Then 输入框自动填充该 CIDR，且未触发扫描
- Given Desktop App 存在多个 IPv4 网段候选
  When 打开 Add device → IP scan（advanced）输入框首次渲染
  Then 默认值为“系统默认路由”对应网段；输入框聚焦后出现候选提示（下拉/自动完成）
- Given 用户已手动编辑输入框
  When 候选列表刷新
  Then 不自动覆盖用户当前输入值
- Given 无可用候选（仅 loopback/IPv6 或读取失败）
  When 渲染 IP scan 输入框
  Then 保持空值并提示“请手动输入 CIDR”
- Given 远程 Web（GitHub Pages）
  When 打开 Add device
  Then IP scan 输入默认空值，行为与现有版本一致
- Given 输入框已有默认值
  When 用户点击 `Scan`
  Then 仅以当前输入值发起 IP scan 请求
- Given Desktop App UI 实现完成
  When 对照 `design/README.md` 的验收图与规范
  Then IP scan（advanced）区块的排版/字号/对齐与示意图一致（不引入新视觉语义）
- Given Desktop App 打开 Add device 弹窗
  When 对照 `design/README.md` 中 “Add device 弹窗（整体效果）” 验收图
  Then 弹窗整体布局与左右列对齐符合示意图（不引入新视觉语义）
- Given IP scan（advanced）处于多候选状态
  When 下拉建议出现
  Then 下拉为浮层，不占用布局高度，允许溢出弹窗边界

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: Web domain 层对 `LanCandidate` → `defaultCidr` 的映射与 UI 初始值逻辑。
- Integration tests: Desktop 后端网卡枚举 → 候选列表的过滤与排序规则。
- E2E tests (if applicable): Desktop 模式下打开 Add device 并断言输入框默认值与候选提示存在。

### UI / Storybook (if applicable)

- Stories to add/update: Add device / IP scan advanced（含多候选与无候选）。
- Visual regression baseline changes (if any): 仅当 UI 结构变化时更新。

### Quality checks

- `cd web && bun run check`
- `cd web && bun run build`
- `cargo build`（Desktop/Rust 侧）

## 文档更新（Docs to Update）

- `docs/plan/0007:add-device-discovery/PLAN.md`: 更新 IP scan 输入默认值规则（Desktop only）。
- `docs/plan/0008:tauri-desktop-client/PLAN.md`: 补充 discovery snapshot 含网段候选/默认值。
- `docs/networking.md`: 记录“本机网段候选”生成与过滤规则（如已存在相关章节）。
- `docs/plan/0013:ip-scan-lan-autofill/design/README.md`: 高保真设计与验收图（本计划产出）。

## 里程碑（Milestones）

- [ ] M1: 冻结 `LanCandidate` / `DiscoverySnapshot.ipScan` 形状与契约文档
- [ ] M2: Desktop 后端输出候选网段（HTTP + RPC）
- [ ] M3: UI 默认值 + 自动完成 + 测试覆盖

## 方案概述（Approach, high-level）

- Desktop 侧基于系统网卡信息生成 IPv4 私网候选列表，选取“默认路由”对应网段作为 `defaultCidr`。
- UI 使用“输入框 + 自动完成候选”模式（例如 `datalist` 或等效组件）展示多候选。
- 当用户已编辑输入框时，不自动回填，避免打断输入。

## 风险与开放问题（Risks & Open Questions）

- 风险：默认候选与用户期望不一致时可能造成误扫或体验困惑。
  - 已决策：多候选时默认值为“系统默认路由网段”；过滤 VPN/虚拟网卡；不做上次选择持久化。

## 假设（Assumptions）

- 默认只提供 IPv4 私网候选（RFC1918），不处理 IPv6 CIDR。
- 候选列表为空时，UI 仅提示而不阻塞用户手动输入。

## 参考（References）

- `docs/plan/0007:add-device-discovery/PLAN.md`
- `docs/plan/0008:tauri-desktop-client/PLAN.md`
