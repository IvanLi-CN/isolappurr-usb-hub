# Web UI 交互设计规范

## 范围（Scope）

- 适用范围：`web/` 目录下的 React UI（Browser Web + Desktop App 复用的 Web UI）。
- 不适用范围：Tauri 原生外壳层（窗口/菜单/系统栏）、固件侧 UI、设备 API 行为。

## 问题陈述

当前 Web UI（含 Desktop App 复用的 Web UI）需要一份稳定、可落地、可验收的“交互设计规范”，用于：

- 明确弹窗/滚动/键盘等交互边界，避免不同页面/组件口径不一致
- 为“自发现问题 + 修复 + 回归”提供可执行检查清单

## 目标 / 非目标

### Goals

- Modal 的打开/关闭/滚动策略一致，且在小高度窗口下行为可预测。
- 关键流程（Add device）在不同状态（scanning/ready/unavailable/error）下交互一致、无歧义。
- 交互可验收：每条规则都能通过 Given/When/Then 或 checklist 检查。

### Non-goals

- 不改变业务规则（discovery、IP scan、去重逻辑等以既有 plan 为准）。
- 不要求引入新依赖或重做整体 IA（Information Architecture）。

## 自适应与窗口变化（Responsive / Resize）

目标：窗口尺寸变化（分屏/拉伸）时，交互行为仍可预测；关键 CTA 不会“消失在不可达区域”。

要求：

- 当视口变窄/变矮时：
  - 页面允许纵向滚动，但不得出现横向滚动条（除非是明确的横向滚动组件）。
  - Modal 仍需保持在视口内（含外边距），并确保主要交互（例如 `Cancel/Create`）可达。
- 当窗口在 modal 打开期间发生 resize：滚动归属与 CTA 可达性不应被破坏。

## 全局导航与页面滚动（Global scroll）

目标：用户永远知道“当前滚动的是哪一层”；避免多层嵌套滚动导致迷失。

要求：

- Page-level：页面主体允许纵向滚动；不要因为某个子卡片内容较长就让整页出现意外横向滚动。
- Sidebar（设备列表）当条目过多时应提供可预测的滚动方式：
  - 允许“侧栏内部滚动”（推荐）或“整页滚动”（备选），但必须避免出现“侧栏与主内容同时滚动且难以控制”的双滚动体验。
- 所有可滚动区域必须有明确边界（容器高度与 `overflow-y` 归属清晰）。

## Modal 通用规则

### 打开与关闭

- 打开 modal 后必须聚焦到首个可编辑字段（例如 Add device 的 `Name`）。
- 关闭入口：
  - 点击遮罩层（backdrop）可关闭
  - `Escape` 可关闭
  - 明确的 `Cancel` 按钮可关闭
- 关闭时需要取消正在进行的长任务（例如 IP scan）。

### 键盘与可访问性（最低要求）

- `Tab` 顺序应符合视觉阅读顺序（左→右，上→下）。
- 不把 `Enter` 作为“全局关闭/全局提交”快捷键（避免误触发与意外关闭）。
- `aria-label` 应为可读的人类文本（例如 `Add device`）。

## 滚动策略（Scroll）

目标：避免“整张弹窗滚动”导致的迷失与 CTA 不可达；优先使用列内滚动。

要求：

- 当内容超过可视高度时，滚动应发生在内容列内部（例如 discovery 列表、表单内容区），避免 modal 外层滚动。
- `Cancel/Create` 操作区在小高度窗口下必须保持可达（不被滚动推离视口）。
- 滚动区域必须有明确边界（容器高度与 `overflow-y` 归属清晰），避免出现“滚着滚着不知道滚的是哪一层”。

## Add device（Discovery + Manual）交互规范

本节为 Plan #0007 的交互口径补充“实现验收要点”；细节参考：

- `docs/plan/0007:add-device-discovery/PLAN.md`
- `docs/plan/0007:add-device-discovery/contracts/ui-components.md`

### 状态与反馈

- Discovery 状态必须清晰可见（idle/scanning/ready/unavailable）。
- 错误提示需可读可执行：
  - 说明原因（短句）
  - 给出下一步（例如“Try IP scan (advanced) with a CIDR range”或“use Manual add”）

### IP scan（advanced）

- 默认折叠为一行（`Show`/`Hide` 文本链接），避免占用列表高度。
- Desktop App：30 秒无新增设备时允许自动展开，并提示用户可尝试手动输入 CIDR。
- 在 Web（浏览器）遇到 PNA/CORS 阻断时必须给出可读提示，并明确建议用 Manual add 作为 fallback。

### 选择候选设备

- 选择某条候选后，右侧表单应自动填充：
  - `Base URL`（必填）
  - `ID`（优先 `device_id`）
  - `Name`（优先 `hostname`）
- 该行为不应触发表单提交；提交仍需用户显式点击 `Create`。

### Manual add 提交行为（建议口径）

- `Create` 点击后：
  - 输入合法：创建并关闭 modal
  - 输入不合法：展示就地校验错误并保持 modal 打开
- 键盘：
  - `Enter`（在 Manual add 的输入框内）：建议等价于点击 `Create`（实现阶段落地）
  - `Escape`：关闭 modal（不提交）

## 交互验收（Given/When/Then 模板）

- Given：打开 Add device modal
  When：窗口高度较矮导致内容超出可视区域
  Then：滚动发生在列内（列表/表单内容区），而不是整张 modal 滚动
  And：`Cancel/Create` 仍可达

- Given：打开任意页面（Dashboard / Device / About）
  When：将视口宽度缩小到 360px
  Then：页面不出现横向滚动条
  And：主要 CTA（例如 `+ Add` / `Add device` / tabs）仍可点击

- Given：用户在 Web 端执行 IP scan 且被 PNA/CORS preflight 阻断
  When：扫描结束或错误出现
  Then：UI 展示可读错误提示与下一步建议
  And：Manual add 不受影响

## 审计清单（Interaction audit checklist）

实现/回归时按此清单自检：

- modal 是否支持 `Escape` / 点击遮罩关闭？
- 打开 modal 是否自动聚焦首个字段？
- 小高度窗口下滚动是否“列内滚动”，且 CTA 可达？
- IP scan 默认是否折叠？30 秒无新增时是否按规则自动展开（Desktop）？
- 关键错误提示是否包含“原因 + 下一步”？
- 视口在 360×640 / 768×800 / 1024×700 下是否仍无横向滚动？
