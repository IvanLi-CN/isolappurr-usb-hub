# Web UI：Dashboard / 设备详情 / About + DaisyUI 主题规范（#0006）

## 状态

- Status: 待实现
- Frozen: 2026-01-11
- Created: 2026-01-11
- Last: 2026-01-11

## 背景 / 问题陈述

- 仓库已具备 `web/`（Vite + React Router + TypeScript + Tailwind + DaisyUI）与“设备列表（localStorage）+ 单设备页面（Mock）”的交互骨架，但整体缺少一致的页面信息架构（IA）、统一的界面风格与可复用的设计规范。
- 需要把 Web UI 的“多设备总览（Dashboard）/ 单设备详情（总览+硬件信息）/ About”三块体验冻结为可实现、可测试、可持续迭代的规范，并为后续对接真机（Plan #0005）留出清晰的状态与交互边界。

## 目标 / 非目标

### Goals

- Dashboard：以网格布局展示**多个设备**的总览信息（每设备两通道 `V/I/P` + 状态），并提供快捷操作按钮（电源 + 通信）。
- 设备详情：左侧设备列表、右侧详情区域；详情可切换“总览（Overview）/ 硬件信息（Hardware）”，并提供“添加新设备”的操作入口与空态指引。
- About：提供产品/版本信息、构建信息、链接与基本使用说明入口。
- 设计规范：以 DaisyUI 为主，定义自定义主题（含 light/dark）、排版/间距/组件用法与状态设计，确保 UI 统一且可扩展。

### Non-goals

- 不在本计划内实现真实设备联调与 API 行为（以 Plan #0005 的 HTTP APIs 为准；本计划只冻结 UI 需要的数据形状与交互）。
- 不在本计划内引入新组件库或 UI 依赖（仅使用现有 Tailwind + DaisyUI + 自建组件）。
- 不在本计划内决定“通信控制”的硬件实现方式（只冻结 UI 语义与所需能力位；若需新增固件动作接口应另开计划或扩展 Plan #0005）。

## 用户与场景（Users & Scenarios）

- 主人/协作者从 GitHub Pages（或本地 dev server）打开 Web UI：
  - 查看所有已配置设备的在线状态与双口遥测；
  - 快速对单个端口执行“断电/上电/Data Replug”；
  - 进入单设备详情查看更多信息（硬件/网络/固件版本），并进行更细粒度操作；
  - 在设备为空时，通过引导添加一个新设备。

## 需求（Requirements）

### MUST

- **Dashboard（多设备）**
  - 主区域以网格（grid）展示所有已配置设备的 Summary Card。
  - 每个设备卡片必须展示：
    - 设备名、`deviceId`（短）、连接状态（online/offline/unknown）与最后刷新时间；
    - 两个端口（`port_a`/`port_c`）的 `V/I/P` 与端口状态（如 `ok/not_inserted/error/overrange`）；
    - 端口操作按钮：电源开关（power）与 Data Replug（一次性触发）。
  - 卡片必须提供进入“设备详情”的入口（点击卡片或显式按钮）。
- **Devices（单设备详情）**
  - 左侧：设备列表（支持选中态、移除、添加）。
  - 右侧：详情区域，至少包含两个 tab：
    - Overview：双口遥测与端口操作（可以复用 PortCard 风格，但需对齐本计划的状态与按钮规范）；
    - Hardware：展示硬件/网络/固件信息（字段来源以 Plan #0005 的 `GET /api/v1/info` 为准）。
  - 当未选中设备或设备列表为空时：详情区域提供清晰的空态与“添加设备”入口。
- **About**
  - 显示 App 名称、构建信息（`sha/date`）、仓库/文档链接（如有）与简要使用说明入口。
  - About 的信息区块应**按内容自适应高度**，避免为了“铺满高度”而出现大面积无意义留白；推荐布局为：上方两列（Build / Links & defaults）+ 下方 Quick usage（见 mockup）。
- **设计规范（DaisyUI 优先）**
  - 统一使用 DaisyUI 组件语义（`card/badge/btn/tabs/modal/tooltip/alert/skeleton` 等），避免自定义样式失控。
  - 提供自定义主题（至少 light/dark 两套），并提供 Theme 切换入口与持久化（localStorage）。
  - 数值显示需稳定：使用等宽/对齐（`font-mono` + `tabular-nums`），统一小数位与单位（显示为 `V/A/W`；数据源仍可为 `mV/mA/mW` 并在 UI 转换）。
  - UI 文案默认英文（未来用 i18n 覆盖；本计划不引入 i18n 框架与翻译资产）。

### SHOULD

- Dashboard 支持搜索/过滤（按名称、在线状态）与排序（在线优先、最近刷新优先）。
- 危险操作（Power Off）提供“按钮旁气泡二次确认”（popover/tooltip 风格；不采用“按住确认”）；气泡内容按单行垂直居中，确认按钮使用 DaisyUI 最小尺寸（`btn-xs`）。
- 气泡为“浮层”而非卡片内整行区域：宽度按内容自适应，并用小箭头指向触发按钮（视觉上不与卡片其它元素整行对齐）。
- 气泡必须是 overlay：显示/隐藏不得改变卡片布局，不得为了“留位置”而下推/挤占其它元素空间。
- 状态与错误呈现一致：
  - Loading：Skeleton；
  - Offline：灰态 + 明确提示；
  - Busy：按钮禁用 + 进度提示（spinner/状态 badge）；
  - API error / preflight blocked：Alert + 可操作的排障文案入口（后续由文档补齐）。
- 小屏体验可用：侧边栏在 `lg` 以下可折叠为 drawer（或顶部按钮展开）。

### COULD

- Dashboard 支持批量操作（全体断电/全体恢复），但默认隐藏或二次确认。
- 设备支持标签/分组（如 “lab/desk/variant”）与分组展示。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web 路由（Dashboard / Device / About） | UI Route | internal | Modify | ./contracts/ui-routes.md | Web | Users | 与现有 `react-router` 路由对齐，并补齐 About 与多设备 Dashboard |
| Dashboard 组件集合（Summary Cards） | UI Component | internal | New | ./contracts/ui-components.md | Web | Web UI | 多设备网格展示与快捷操作（电源 / Data Replug） |
| 设备详情页组件（Overview/Hardware tabs） | UI Component | internal | Modify | ./contracts/ui-components.md | Web | Web UI | 将 “Info” 明确为 “Hardware”，并冻结字段口径 |
| 主题定义与切换 | Config | internal | Modify | ./contracts/config.md | Web | Web UI | DaisyUI custom theme + localStorage 持久化 |
| 主题偏好持久化 | File format | internal | New | ./contracts/file-formats.md | Web | Web UI | localStorage key/value 约定 |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/ui-routes.md](./contracts/ui-routes.md)
- [contracts/ui-components.md](./contracts/ui-components.md)
- [contracts/config.md](./contracts/config.md)
- [contracts/file-formats.md](./contracts/file-formats.md)

## 约束与风险（Constraints & Risks）

- **信息密度风险**：Dashboard 每卡两口 + 多个操作按钮，容易拥挤；需要通过布局与信息分层（默认折叠次要字段、hover/tooltip）控制复杂度。
- **动作语义风险**：“通信控制”的真实含义若与固件能力不一致，会导致 UI 误导；必须在实现前冻结语义与能力位。
- **浏览器限制风险**：从 HTTPS（Pages）访问 HTTP（内网设备）可能涉及 CORS + PNA 行为差异；本计划只冻结 UI 状态呈现，具体网络排障另随 Plan #0005 的文档更新。

## 验收标准（Acceptance Criteria）

### Dashboard（多设备）

- Given：已配置 ≥ 2 个设备
  When：打开 Dashboard
  Then：主区域按网格渲染每个设备的 Summary Card，且每卡均包含 `port_a/port_c` 的 `V/I/P` 与状态占位（即使为 Mock/未连接也必须有一致空态）
- Given：某设备离线/超时（最后一次成功刷新距今 ≥ 10 秒）
  When：Dashboard 渲染该设备卡片
  Then：卡片展示 `offline` 状态，并禁用所有写操作按钮（Power/Data Replug），同时保留进入详情页入口
- Given：用户在任一端口点击 Power/Data Replug 操作
  When：触发动作请求（Mock 或真机）
  Then：按钮进入 busy 状态（禁用 + spinner/提示），成功后状态在下一次刷新中收敛一致；失败时展示可读错误（toast/alert）
- Given：用户尝试将端口电源从 On 切到 Off
  When：点击 Power 控件
  Then：先在按钮旁弹出确认气泡；只有在确认后才触发动作；取消/点击空白处应关闭确认气泡且不触发动作

### Devices（单设备详情）

- Given：用户从左侧列表选中一个设备
  When：进入 Overview tab
  Then：可看到双口遥测与端口操作控件，布局与 Dashboard 的信息口径一致（数值单位、状态 badge、按钮含义一致）
- Given：用户切换到 Hardware tab
  When：渲染硬件信息
  Then：至少展示 `device_id/hostname/fqdn/mac/variant/firmware.version/wifi.ipv4`（字段缺失时需显示 `unknown` 而非空白）
- Given：设备列表为空
  When：打开应用
  Then：左侧显示空态，右侧详情区域展示“添加设备”引导与入口（无需用户猜测下一步）

### About

- Given：用户打开 About
  When：页面渲染
  Then：展示 App 名称、build 信息（短 SHA + date），并包含指向仓库/文档的链接位（无链接时展示占位文案）
  And：上方信息区块为内容驱动（auto height），不应出现“整块空白占位”的卡片区域

### 主题与一致性

- Given：用户切换主题为 `isolapurr-dark`
  When：刷新页面
  Then：主题偏好被持久化并恢复（见 `contracts/file-formats.md`）
- Given：任一 telemetry 数值变化
  When：Dashboard/Overview 展示数值
  Then：数值采用等宽对齐，单位与小数位口径一致，且不会因位数变化导致布局跳动明显（CLS 可感知降低）

## 非功能性验收 / 质量门槛（Quality Gates）

### Web

- `cd web && bun run check`
- `cd web && bun run test:unit`
- `cd web && bun run test:e2e`
- `cd web && bun run build`
- 若 Storybook 已启用：`cd web && bun run test:storybook`（至少对关键面板：DeviceSummaryCard/PortCard）

## 文档更新（Docs to Update）

- `web/README.md`：补充页面导航、主题切换、Dashboard/Devices/About 的使用说明与截图位（实现阶段补齐）。
- `docs/plan/0004:github-pages-ports-dashboard/PLAN.md`：如仍在推进，建议在“后续”中引用本计划（UI 规范冻结）。
- `docs/plan/0005:device-http-api/PLAN.md`：若“通信控制”需要新增接口，必须同步更新其契约与验收标准（或另开计划）。

## 参考效果（References）

- [UI 参考效果（Wireframes）](./references/wireframes.md)
- [UI 效果图（Mockups）](./references/mockups/README.md)

## 里程碑（Milestones）

- [x] M1: 冻结 IA（路由/导航）与主题规范（tokens + 交互）
- [ ] M2: （impl）实现 Dashboard：多设备网格 + Summary Card + 状态/空态
- [ ] M3: （impl）实现 Devices：详情 tabs（Overview/Hardware）与一致化组件
- [ ] M4: （impl）实现 About：build 信息 + 链接 + 文案
- [ ] M5: （impl）补齐测试与 Storybook 覆盖（关键状态与交互）

## 开放问题（需要主人决策）

None（本计划范围与关键口径已冻结）：

- 通信控制：使用 Data Replug（一次性触发）。
- Dashboard 数值显示：`V/A/W`（由 `mV/mA/mW` 转换）。
- UI 文案：默认英文，未来 i18n。
- 离线阈值：最后一次成功刷新距今 ≥ 10 秒判定 offline。
- Dashboard：每张卡片独立操作，不存在“先选中设备再操作”的交互前置。

## 假设（Assumptions）

None。

## 参考（References）

- Plan #0004：GitHub Pages Web（Mock）骨架与现有组件结构
- Plan #0005：设备 HTTP API（对接 Web 的真实数据/动作契约）
- `web/tailwind.config.js`：当前 DaisyUI 集成方式（后续按本计划自定义主题）
