# Web UI 界面设计规范

## 范围（Scope）

- 适用范围：`web/` 目录下的 React UI（Browser Web + Desktop App 复用的 Web UI）。
- 不适用范围：Tauri 原生外壳层（窗口/菜单/系统栏）、固件侧 UI、设备 API 行为。

## 问题陈述

当前 Web UI（含 Desktop App 复用的 Web UI）需要一份稳定、可落地、可验收的“界面设计规范”，用于：

- 统一视觉口径（排版/间距/层级/组件使用方式）
- 作为后续“自发现问题 + 修复 + 回归”的依据，避免边改边变口径

## 目标 / 非目标

### Goals

- 视觉系统有统一基线：主题（Theme）、颜色语义（Token meanings）、排版层级、间距与对齐规则。
- 组件视觉保持一致：卡片、面板、弹窗、表单、提示/错误态的表现方式可复用。
- 避免“无意义留白”：尤其是弹窗（modal）内部不应出现大块空白占位区域。

### Non-goals

- 不引入新的 UI 框架/依赖（沿用 React + Tailwind + DaisyUI + 现有 `iso-*` 组件风格）。
- 不定义业务规则（例如 discovery 逻辑、IP scan 策略、设备 API 行为等）。

## 自适应与多尺寸（Responsive）

目标：在常见窗口尺寸与分屏场景下，页面/组件保持可读、可操作，且**不出现横向滚动条**（除非是明确的横向滚动组件）。

### 支持的视口范围（验收口径）

> 说明：这是“必须保证体验”的尺寸范围；更小尺寸允许体验降级，但不得出现内容不可达或 UI 崩坏。

| 场景 | 宽度（px） | 高度（px） | 备注 |
| --- | --- | --- | --- |
| Mobile（最小可用） | 360 | 640 | 允许单列布局与页面纵向滚动 |
| Tablet | 768 | 800 | 允许侧栏堆叠为上方区域 |
| Laptop（分屏常见） | 1024 | 700 | 必须保证关键 CTA 可达（尤其是 modal） |
| Desktop | 1280–1600 | 800–900 | 信息密度与对齐稳定 |

统一要求：

- 所有页面与 modal 在上述尺寸下：不得出现横向滚动条；文本与按钮不应被裁切到不可读/不可点。
- 长文本（例如 `baseUrl`/`fqdn`/`device_id`）必须采取可预测的截断或换行策略，避免撑破布局。

### 断点与布局切换（建议口径）

> 断点以 Tailwind `sm/md/lg/xl` 为主；只有在确有必要时才使用 `min-[...]` 的自定义断点。

- AppLayout：
  - `xl` 及以上：Sidebar 固定在左侧，Main 右侧自适应。
  - `xl` 以下：Sidebar 与 Main 纵向堆叠（先 Sidebar 后 Main），避免强行两列导致拥挤。
- Add device dialog：
  - `min-[980px]` 及以上：左右两列（Discovery / Manual）。
  - 小于该宽度：单列堆叠（先 Discovery 后 Manual），并保持 CTA 可达。

## 视觉基线（Theme / Tokens）

- DaisyUI themes：
  - `isolapurr`（light, default）
  - `isolapurr-dark`（dark）
- token 语义与主题切换规则：以 `docs/plan/0006:web-ui-screens-and-theme/contracts/config.md` 为准。

规范性要求（要点）：

- `primary`：仅用于主 CTA（例如 Add device / Create / Apply）。避免把大量普通按钮都做成 `primary`。
- `success/warning/error/info`：仅用于状态表达，不用于“装饰性上色”。
- disabled：保持文字可读，不通过极低 opacity 让内容“消失”。

## 文字与长字段（Overflow / Truncation）

目标：长字段不破坏布局；用户能理解“这是一段被截断的文本”。

规则：

- 在卡片/列表/页头中展示 `baseUrl` 等长字符串时，优先使用 `truncate`（单行）并配合：
  - `min-w-0`（避免 flex 子元素撑破）
  - 可选：hover/tooltip 展示完整值（实现阶段再决定）
- 在需要可复制/可阅读的场景（例如详情页 Hardware 信息），允许换行，但必须使用可控的断行策略（例如 `break-all` 或 `break-words`）以避免横向溢出。

## 排版与信息层级（Typography / Hierarchy）

要求：

- 页面/弹窗标题必须清晰（标题与辅助说明分层），避免“所有文字同一层级”导致扫读困难。
- label / helper text / error text 三者必须能区分（位置与颜色语义要稳定）。
- 避免用多层卡片叠加来表达层级：优先用 `border` / `bg-base-*` / `shadow` 建立层次。

## 布局与间距（Layout / Spacing）

要求：

- 同一屏幕内的主布局间距保持一致：同级区块之间使用固定的 vertical gap（不要随手写不同的 `mt-*` 组合）。
- 对齐优先：同一列的 label、input、error text 左边缘应对齐；两列布局应对齐顶部基线。
- 空态/提示态不要为了“铺满高度”而强行撑高容器；留白应该是“结构性留白”，而不是“撑出来的空白”。
- 避免依赖固定高度来“对齐到底部”：优先用 flex 的结构化布局（header / scrollable content / actions）。

## 卡片与面板（Card / Panel）

要求：

- 主要信息容器使用统一的 card/panel 样式（`iso-card` / `bg-[var(--panel)]` / `border` 等）。
- 子区域（例如列表容器、折叠高级区块）优先使用轻层级背景（`bg-[var(--panel-2)]` 或 DaisyUI `base-200` 语义）+ 边框，不要嵌套多层厚重阴影。

## 固定尺寸（Fixed sizes）使用规则

原则：固定宽高只能用于“确实需要固定的视觉模块”（例如小型 badge、按钮高度），不应用于承载可变内容的主要容器。

要求：

- 大容器（页面主卡片、modal、面板）不得只用 `h-[...]` 固定高度解决布局；必须配合 `max-h`/`min-h` 与滚动边界，保证小高度窗口可用。
- Grid 的 `minmax()` 下限必须考虑移动端/窄窗口，避免设置过大导致 `< 480px` 直接横向溢出。

## 弹窗（Modal）视觉规范

弹窗的视觉目标是：信息密度高、边界清晰、不会贴边、在小高度窗口下仍可读可用。

要求：

- 弹窗四周必须保留外边距（避免贴边），并提供清晰的边界（border/shadow）。
- 弹窗内容区在可用高度内“拉伸填满”，避免底部出现无意义的大块空白。
- 两列布局中左右列应“视觉同权重”（不是左侧被挤到极窄，也不是右侧变成一条长表单）。

## 表单（Form）

要求：

- 必填项（Name/Base URL）与可选项（ID）在视觉上要区分（label 与 helper 文案）。
- 校验错误必须贴近字段出现（input 下方），且错误文案出现不应导致布局整体抖动出大空白。
- 示例文案（Examples）应是辅助信息，不应抢占主要信息层级。

## 提示与错误（Callouts / Alerts）

要求：

- 说明类文案（例如“mDNS Desktop only / PNA 提示 / Discovery unavailable”）使用单层 callout（建议 DaisyUI `alert` 语义），避免 card 里再套 card。
- 错误态与提示态必须可扫读：icon + 主句 + 可选操作/链接，避免长段落堆叠。

## 审计清单（Visual audit checklist）

实现/回归时按此清单自检：

- 是否出现“无意义的大块空白”（尤其是 modal 底部）？
- 是否存在同类组件使用了不同的间距/圆角/边框风格（风格漂移）？
- disabled 状态文字是否仍清晰可读？
- 提示/错误态是否使用了单层 callout，而不是多层容器堆叠？
- 视口在 360×640 / 768×800 / 1024×700 下是否仍无横向滚动？
- 关键页面（Dashboard / Device / About）在窄屏下是否能自然堆叠与换行，不出现裁切？

## 参考（References）

- UI tokens 与主题：`docs/plan/0006:web-ui-screens-and-theme/contracts/config.md`
- 低保真布局参考：`docs/plan/0006:web-ui-screens-and-theme/references/wireframes.md`
- Add device 交互口径：`docs/plan/0007:add-device-discovery/PLAN.md`
