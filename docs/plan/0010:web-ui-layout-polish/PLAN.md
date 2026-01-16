# Web UI：界面布局与滚动问题修复（含 Add device 弹窗）（#0010）

## 状态

- Status: 已完成
- Created: 2026-01-15
- Last: 2026-01-16

## 背景 / 问题陈述

- 当前 Web UI 在多尺寸（窄屏/分屏/小高度窗口）下存在布局自适应不足的问题：常见表现包括内容横向溢出、固定高度导致无意义留白、滚动归属不清导致 CTA 不可达等。
- `Add device` 弹窗“底部大块空白”是其中一个典型例子；但本计划的目标是把问题收敛为一份覆盖全站关键页面与组件的 Issue Inventory，并冻结成可复现、可验收、可回归的交付清单。
- 约束：不改变既有功能与交互口径（Plan #0006/#0007），仅做布局/样式/可达性层面的修复。

## 目标 / 非目标

### Goals

- 覆盖并修复本计划列入的全部 Issue Inventory（见下文），每条问题都有可复现步骤与可验收标准。
- 产出并冻结两份规范文档，作为“自发现问题 + 实现修复 + 验收回归”的唯一口径：
  - `docs/web-ui-visual-spec.md`（界面设计规范）
  - `docs/web-ui-interaction-spec.md`（交互设计规范）
- 冻结统一的布局/滚动规则，确保 Web 与 Desktop（Plan #0008）一致：
  - 弹窗/页面不超过视口高度，四周保留外边距；
  - 内容过长时优先采用“列内滚动”（见下文已冻结决策）。
- 保障 Desktop（Plan #0008）与 Web 的视觉一致性：同一套 React UI 在两种承载形态下表现一致。

### Non-goals

- 不改变 Auto discovery / IP scan / Manual add 的业务规则与状态机（以 Plan #0007 为准）。
- 不引入新的 UI 依赖或重做整体视觉风格（沿用现有 React + Tailwind + DaisyUI）。
- 不改动设备侧 HTTP API 契约（Plan #0005）。
- 不包含 Tauri 原生外壳层（窗口/菜单/系统栏等）的布局问题；仅覆盖 `web/` 里复用的 React UI。

## 用户与场景（Users & Scenarios）

- 用户在不同窗口尺寸下使用 Web UI（Browser 或 Desktop App WebView）：
  - 窄屏（≈360px）：页面应自然堆叠，不出现横向滚动；长字段（`baseUrl` 等）不应撑破布局。
  - 分屏/小高度（≈1024×700）：modal 不应溢出视口；滚动归属明确；关键 CTA 必须可达。
  - 多设备/长列表：Sidebar 设备列表与 Discovery 列表应可滚动，且不会把其它区域挤出可视范围。

## 需求（Requirements）

### MUST

- 本计划的 Issue Inventory 必须冻结为一个闭集（不在实现阶段临时追加范围）；若发现新增问题，另开 plan 或追加到新的 plan。
- 必须先完成并冻结 `docs/web-ui-visual-spec.md` 与 `docs/web-ui-interaction-spec.md`；后续发现问题与修复必须以这两份文档为依据（避免“修好了但口径不一致”）。
- 响应式与多尺寸（冻结）：
  - 视口在 360×640 / 768×800 / 1024×700 / 1280×800 下均不得出现横向滚动条。
  - 页面允许纵向滚动，但不得出现“滚动归属不清”的多层滚动（除非是明确的列内滚动，例如 modal 内列表）。
  - 长字段（`baseUrl`/`fqdn`/`device_id`）必须采取可预测的截断或换行策略，避免撑破布局。
- 高度与外边距（冻结）：
  - 弹窗不得超过视口高度（`max-height` 约束），且四周必须保留外边距（避免贴边）。
  - 弹窗内容区应在可用高度内“拉伸填满”，避免出现无意义的大块空白。
- 滚动策略（冻结）：
  - 内容超出可视区域时，优先采用“列内滚动”，避免整张弹窗（modal）滚动。
  - `Cancel/Create` 操作区在小高度窗口下仍需保持可达（不被滚动推离视口）。

### SHOULD

- 在 Storybook 中提供 `Add device` 弹窗的可复现用例（含：扫描中、候选多条、错误提示、表单校验错误），用于布局回归检查。
- 视觉对齐：按钮区与弹窗底部 padding 保持一致，不出现额外的“第二层空白”。

### COULD

- 为 Desktop（Plan #0008）提供一个“窗口高度较矮”的预设视口用例（Storybook viewport）以便快速验证滚动策略。

## 接口契约（Interfaces & Contracts）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| None | - | - | - | - | - | - | 本计划仅涉及 UI 布局/样式调整，不触及跨边界接口 |

## 验收标准（Acceptance Criteria）

- 本计划采用“逐条问题验收”：
  - Issue Inventory 中每条问题必须有至少 1 条 Given/When/Then（含边界条件），实现完成后逐条关闭。

### 多尺寸（全局门槛）

- Given：打开任一页面（Dashboard / Device / About）
  When：将视口宽度缩小到 360px
  Then：页面不出现横向滚动条
  And：主要 CTA（例如 `+ Add` / `Add device` / tabs）仍可点击

- Given：打开 Add device modal
  When：在 1024×700（分屏常见）下观察
  Then：modal 不超过视口高度且四周保留外边距
  And：滚动发生在列内（列表/表单内容区），而不是整张 modal 滚动
  And：`Cancel/Create` 仍可达

### Add device 弹窗（重点问题，必须包含在清单内）

- Given：打开 `Add device` 弹窗（任一状态：扫描中/无结果/有多个候选）
  When：在 Desktop 常见窗口高度下观察弹窗
  Then：弹窗底部不出现明显“空白占位区域”
  And：弹窗不超过视口高度，四周保留外边距

- Given：窗口高度较矮（例如分屏导致可视高度不足）
  When：`Add device` 弹窗内容超出可视区域
  Then：滚动发生在 discovery 列表（或两列）内部，而不是整张弹窗滚动

- Given：右侧表单存在校验错误（Name/Base URL/ID）
  When：错误文案出现并导致内容高度变化
  Then：布局不产生新的大块空白；滚动策略仍保持一致

## 界面问题清单（Issue Inventory）

> 说明：这里列出本计划“需要解决的全部界面问题”，进入实现前冻结；每条都要能复现、能验收。

| ID | Area | Symptom | Repro (short) | Expected | Notes |
| --- | --- | --- | --- | --- | --- |
| UI-001 | Add device dialog | 固定高度导致无意义留白（底部大空白） | 打开 Add device dialog（默认窗口高度） | 内容区填满可用高度；无明显空白；`Cancel/Create` 位于可预测位置 | 主诉问题（reported） |
| UI-002 | Add device dialog | 小高度窗口下可能溢出/滚动不确定 | 视口 1024×700 打开 modal | modal 不超过 viewport；滚动仅在列内；操作区仍可达 | 覆盖分屏/小屏 |
| UI-003 | Add device dialog (Discovery panel) | 长字段（baseUrl/device_id）可能撑破布局或难以阅读 | discovery 列表出现长 hostname/baseUrl | 长字段应截断/换行，不引入横向滚动；信息仍可扫读 | 关联视觉规范的 overflow 规则 |
| UI-004 | Sidebar（Device list） | 设备数量多时侧栏无明确滚动策略，可能挤出可视区域 | 添加 ≥ 20 个设备并缩小窗口高度 | 侧栏内列表可滚动，且不引发双滚动迷失 | 交互规范：Global scroll |
| UI-005 | Device card（Sidebar） | `baseUrl` 在窄屏下无截断/换行，可能溢出 | 窗口宽度 360px，baseUrl 很长 | baseUrl 必须可预测截断/换行，不撑破布局 | `DeviceCard` 展示 |
| UI-006 | Device page header | 设备页头 `id • baseUrl` 在窄屏下可能溢出 | 访问 `/devices/:id`，宽度 360px | header 文本截断/换行策略明确，不出现横向滚动 | Overview/Hardware 共用 |
| UI-007 | Device overview（Port cards grid） | `minmax(480px,1fr)` 导致 <480px 窗口横向溢出 | `/devices/:id`，宽度 360px | PortCard 布局需能在窄屏单列显示且不溢出 | `DeviceDashboardPanel` |
| UI-008 | About（Top cards grid） | `minmax(480px,1fr)` 导致 <480px 窗口横向溢出 | `/about`，宽度 360px | About 顶部卡片应单列堆叠且不溢出 | `AboutPage` |
| UI-009 | Hardware（Firmware/WiFi grid） | `minmax(480px,1fr)` 导致 <480px 窗口横向溢出 | `/devices/:id/info`，宽度 360px | Firmware/WiFi 卡片应单列堆叠且不溢出 | `DeviceInfoPanel` |
| UI-010 | About（Quick usage card） | 固定高度 `h-[288px]` 在窄屏/字体变化下可能内容溢出或留白不合理 | `/about`，窄屏或长文案 | 内容驱动高度（或合理的 max-height + 内部滚动），不裁切关键文案 | 视觉规范：Fixed sizes |
| UI-011 | App header | 小宽度下固定 padding/按钮宽度可能导致拥挤或溢出 | 视口 360px 打开 `/` 或 `/about` | header 可压缩/换行/收纳，不出现横向滚动 | `AppLayout` |

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: 无新增强制要求（优先用 Storybook 覆盖布局回归）。
- E2E (if applicable): 可选增加 Playwright 冒烟（打开弹窗、滚动可达 CTA）。

### UI / Storybook

- 必须新增或补齐下列 Storybook 用例，用于多尺寸回归（不追求视觉回归工具，先保证布局可验证）：
  - `AddDeviceDialog`（含：scanning/empty/long list/error/ip-scan-expanded/form-errors）
  - `DeviceCard`（长 `baseUrl` 的截断/换行表现）
  - `DeviceDashboardPanel`（窄屏下 Port cards 的堆叠表现）
  - `DeviceInfoPanel`（窄屏下 Identity/Firmware/WiFi 的堆叠表现）
  - `AboutPage`（顶部卡片 grid 与 Quick usage 在窄屏下的行为）
- 通过：`cd web && bun run build-storybook`（以及如需要的 `bun run test:storybook`）。
  - 视口至少覆盖：360×640、768×800、1024×700、1280×800。

### Quality checks

- `cd web && bun run check`
- `cd web && bun run build`

## 文档更新（Docs to Update）

- `docs/web-ui-visual-spec.md`：本计划产物（界面设计规范），后续 UI 变更需遵循。
- `docs/web-ui-interaction-spec.md`：本计划产物（交互设计规范），后续 UI 变更需遵循。
- `docs/plan/0007:add-device-discovery/PLAN.md`：如本计划对“弹窗布局/滚动”做了新增冻结决策，需要回写到 #0007 的 UI 口径（确保 Desktop 与 Web 统一）。

## 里程碑（Milestones）

- [x] M1: 写并冻结 UI 规范文档（visual + interaction）
- [x] M2: UI audit：对照规范补齐并冻结 Issue Inventory（本计划）
- [x] M3: 修复 Add device 弹窗布局与滚动（对齐 Issue Inventory）
- [x] M4: 补齐 Storybook 用例与视口（含小高度场景）
- [x] M5: 完成回归验证（Web + Desktop 复用场景）

## 方案概述（Approach, high-level）

- 总体原则：仅做布局/样式/可达性层面的调整；不修改 discovery 逻辑与表单校验逻辑（Plan #0007 口径不变）。
- Modal（对应 UI-001~003）：
  - 移除“纯固定高度”的依赖；改为 `max-height` + 结构化布局（header / columns / actions）。
  - 明确滚动归属：列表与表单内容区列内滚动，避免整张 modal 滚动；CTA 区保持可达。
- Responsive grids（对应 UI-007~009）：
  - 调整 `minmax()` 的下限或改用断点式 `grid-cols-*`，确保 360px 宽度下不产生横向溢出。
- 长文本展示（对应 UI-003/005/006）：
  - 在卡片/页头等空间受限区域使用 `truncate` + `min-w-0`；在详情区域使用可控换行（`break-words`/`break-all`）。
- Sidebar 滚动（对应 UI-004）：
  - 统一“长列表”的滚动策略（侧栏内滚动或整页滚动二选一），避免双滚动与内容挤出视口。

## 约束与风险（Constraints & Risks）

- 风险：
  - `<dialog>` + DaisyUI `modal` 在不同承载形态（浏览器 vs Tauri WebView）对 `height/max-height/overflow` 的表现可能存在细微差异，需要通过 Storybook 视口与 Desktop 冒烟共同验证。

## 开放问题（Open Questions）

None。

## 假设（Assumptions）

None（本计划仅针对布局问题，不改变 `Add device` 的字段、校验规则与 discovery 行为）。

## 参考（References）

- 关联计划：
  - Plan #0007：Add device UI 口径（自动发现 + 手动添加）
  - Plan #0008：Desktop（Tauri）复用 Web UI 的承载形态与验证路径
