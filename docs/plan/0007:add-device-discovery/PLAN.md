# Web UI：添加设备（自动发现 + 手动添加）（#0007）

## 状态

- Status: 待实现
- Created: 2026-01-12
- Last: 2026-01-13

## 背景 / 问题陈述

- 当前 UI 已支持“手动添加设备（Name/Base URL/ID）”，但当用户不知道设备 IP/hostname 时，添加流程不顺畅。
- 冻结决策：**服务发现（mDNS/DNS‑SD）仅在 Desktop（Plan #0008）中支持**（包含 Tauri GUI 与“本地程序启动后用系统浏览器打开的本地 UI”两种形态）；**远程 Web（GitHub Pages）** 不提供 mDNS 服务发现，但仍支持 **IP scan（advanced，用户手动输入 CIDR）** 作为“局域网扫描”方式（依赖 Plan #0005 的 CORS + Private Network Access（PNA）预检）。

## 目标 / 非目标

### Goals

- 交付一个可实现、可测试的 “Add device（含 Discovery UI）” 交互规范（对齐 Plan #0006 视觉与 modal 规则）：
  - Desktop：左侧 Auto discovery（自动发现），右侧 Manual add（手动添加）。
  - Manual add 始终可用，不被 discovery 阻塞。
- Discovery 结果与手动输入共用同一套校验/去重规则；对“已添加的设备”提供明确状态提示。
- UI 视觉与交互对齐 Plan #0006 的 DaisyUI 风格与 modal overlay 规则，并提供高保真效果图用于实现对齐。

### Non-goals

- 不在本计划中改变设备侧业务 API（Plan #0005）的既有契约（本计划只消费 `GET /api/v1/info` 用于识别与展示）。
- 不在本计划中引入新的 UI 库/依赖（沿用 `web/` 现有 React + Tailwind + DaisyUI）。
- 不在本计划中为**远程 Web（GitHub Pages）**实现“服务发现（mDNS/DNS‑SD）”（浏览器缺少 UDP/multicast 能力）；服务发现由 Plan #0008 负责。
- IP scan（advanced）规则（远程 Web / Desktop 通用）：
  - CIDR 必须用户显式输入并触发扫描；范围**不做自动猜测/预填**（避免误扫与隐私风险）。
  - 远程 Web 依赖 Plan #0005 的 CORS + PNA 预检与权限提示；用户拒绝时应给出可读提示与排障建议。
  - Desktop App 可额外提供“建议网段”作为输入辅助，但必须要求用户显式确认（见 Plan #0008）。

## 用户与场景（Users & Scenarios）

- 用户在同一局域网中使用 UI：
  - 场景 A（Desktop App）：不知道设备 IP/hostname，希望“一键发现并添加”；
  - 场景 B（远程 Web）：不知道设备 IP/hostname，希望通过“手动输入 CIDR 的 IP scan”找到设备并带入；
  - 场景 C（远程 Web / Desktop）：已知 `baseUrl`，希望“立即手动输入并添加”，不想等待 discovery；
  - 场景 D（Desktop App）：同网段多台设备，需避免重复添加，并能快速区分哪台是哪台。

## 需求（Requirements）

### MUST

- **入口与承载形态**
  - 入口仍为 Devices 面板的 “+ Add”（Plan #0004/#0006）。
  - Add device 使用 modal（`<dialog class="modal">`）并覆盖全屏遮罩（对齐 Plan #0006 的 modal overlay rules）。
- **Desktop 布局（关键需求）**
  - modal 内容区为两列布局：
    - 左：Auto discovery
    - 右：Manual add
  - 两列在视觉上同权重；Manual add 的 CTA（Create）始终可点击（只受输入校验影响）。
- **Auto discovery（左侧）**
  - 可用性：
    - Desktop App（Plan #0008）：启用服务发现（主路径：mDNS/DNS‑SD）+ IP scan（advanced）
    - 远程 Web（GitHub Pages）：不提供 mDNS 服务发现（显示提示），但提供 IP scan（advanced）用于局域网扫描
  - **主路径：服务发现（Service discovery, Desktop App only, MUST）**
    - 打开 modal 后自动进入 scanning 状态，并通过 **mDNS / DNS‑SD** 在局域网内进行服务发现（“真正的服务发现”作为主手段）。
    - 发现结果必须通过调用设备 `GET /api/v1/info`（Plan #0005）进行验证与字段补全，避免把局域网里无关的 HTTP 服务误识别为本产品设备。
  - **备选路径：IP 扫描（IP scan, 远程 Web + Desktop, MUST）**
    - 提供 “IP scan（advanced）” 区块；只有用户**手动输入 CIDR 范围**并点击 `Scan` 后才开始扫描（不得自动猜测网段）。
    - UI 形式：**默认折叠（collapsed）**为一行 “IP scan (advanced)” + 文本链接 `Show`（右侧 Iconify 图标：`tabler:chevron-down`）；避免长期占用列表可视空间。
    - 展开时机：
      - 用户点击 `Show`（手动展开）
      - Desktop App：服务发现开启后 **30 秒内没有发现任何新设备**（device 列表无新增）时自动展开（并提示用户可尝试 IP scan）
    - CIDR 输入默认空；UI 可给出示例与校验错误，但不得“默认帮用户填一个看起来像局域网的范围”。
    - 扫描过程中展示明确进度与可取消（不要求实现层细节，但 UI 必须有状态位）。
  - Discovery 列表项必须至少展示：`hostname/fqdn`、`ipv4`（如有）、`device_id`、`firmware.version`（如有）、以及用于添加的 `baseUrl`（优先 `http://<hostname>.local`，必要时回退 `http://<ipv4>`）。
- Discovery 列表为**可滚动区域**：当结果较多时，仅列表区域滚动；`Auto discovery` 的 header（标题/状态/Refresh）、Filter 输入框、以及底部 `IP scan (advanced)`（默认折叠）保持可见（sticky/pinned）。
  - 对已存在于本地设备列表中的 discovery 结果：标记为 “Added”，并禁用其操作（避免重复）。
- **Manual add（右侧）**
  - 字段：`Name`（必填）、`Base URL`（必填）、`ID (optional)`（可选；空则自动生成），与现有校验口径一致。
  - 支持从左侧 discovery 结果“一键带入”：选择某个结果后自动填充 `Base URL`，并建议填充 `ID=device_id`；`Name` 默认使用 `hostname`（用户可改）。
  - 冻结交互（已确认）：左侧 discovery 的操作只负责“带入右侧表单”，真正写入本地配置必须由用户点击右侧 `Create` 完成。
- **错误与空态（可读且不阻塞）**
  - 远程 Web：左侧显示“mDNS 服务发现仅 Desktop App 支持”的提示与使用建议；IP scan 可用；右侧 Manual add 仍可正常使用。
  - Desktop App：当 discovery 后端不可用（例如内部错误/网络异常）时：左侧显示可读原因与重试入口（如 `Refresh`），但右侧 Manual add 仍可正常使用。
  - Desktop App：当服务发现未发现设备：左侧展示空态 + “Refresh” + 建议（检查 Wi‑Fi/同网段/设备是否上电）。
  - **提示样式（UI 约束）**：左侧的“Desktop App only / Discovery unavailable / PNA 权限提示”等说明信息使用 **alert / inline callout**（单层容器 + icon + 文案 + link/按钮），**不要用 `card` 组件**，也不要出现“卡片里再套卡片”的嵌套效果；避免重复表达同一句信息（例如标题与副标题重复）。

### SHOULD

- **Mobile 自适应**
  - 移动端两列改为上下布局，或使用 tabs（`Discovery` / `Manual`）切换；但 Manual add 的入口必须清晰且不隐藏太深。
- **体验细节**
  - Discovery 列表支持简单过滤（按 `hostname/device_id` 子串）。
  - 提供“Last seen”轻量提示（例如 `just now / 3s`）用于区分在线/陈旧条目。

### COULD

- 允许用户在 Manual add 中一键粘贴 `http://<hostname>.local`，并在输入框旁提供常用示例按钮（不会改变校验口径）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Add device dialog（含 discovery UI） | UI Component | internal | Modify | ./contracts/ui-components.md | Web | `DeviceListPanel` | 保持对外 props 尽量稳定 |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/ui-components.md](./contracts/ui-components.md)

## 验收标准（Acceptance Criteria）

### 布局与入口

- Given：用户在浏览器打开 Web UI（非 Desktop App 环境）
  When：点击 “+ Add”
  Then：出现 modal，并以左右两列展示 `Auto discovery`（左）与 `Manual add`（右）
  And：左侧显示“mDNS 服务发现仅 Desktop App 支持”的提示（不进入 scanning）
  And：左侧仍提供 `IP scan (advanced)`（默认折叠，需用户输入 CIDR 才开始扫描）
  And：右侧 Manual add 的 `Create` 可用（只受输入校验影响）

- Given：用户在 Desktop App 中打开 UI（Plan #0008）
  When：点击 “+ Add”
  Then：出现同款 modal（左右两列）
  And：左侧可进入 scanning/ready/unavailable 等状态（由 Desktop App discovery provider 驱动）
  And：右侧 Manual add 的 `Create` 可用（只受输入校验影响）

### Auto discovery：结果、去重、带入

- Given：UI 运行在 Desktop App，且局域网中存在 ≥ 1 台设备（设备已上电且 HTTP 可达）
  When：modal 打开并进入 scanning/ready（provider 已刷新或正在刷新）
  Then：左侧列表展示每条设备的 `hostname/fqdn/device_id/baseUrl`（字段缺失时显示 `unknown` 而非空白）
- Given：discovery 列表中的某设备 `device_id` 已存在于本地 devices 列表（或 `baseUrl` 相同）
  When：渲染 discovery 列表
  Then：该条目标记为 `Added` 且不可再次添加
- Given：用户在左侧选择一个 discovery 结果
  When：选择动作发生
  Then：右侧 Manual add 自动填充 `Base URL`，并建议 `ID=device_id`（若存在）

### Auto discovery：长列表滚动

- Given：discovery 结果数量超过左侧可视区域
  When：用户滚动 discovery 列表
  Then：仅列表区域滚动，且 header（标题/状态/Refresh）、Filter、以及 `IP scan (advanced)`（默认折叠）保持可见

### IP scan（advanced）：折叠与自动展开

- Given：UI 运行在 Desktop App
  When：用户打开 Add device modal
  Then：`IP scan (advanced)` 默认折叠为一行（文本链接 `Show` + `tabler:chevron-down`），不占用过多列表可视高度
- Given：UI 运行在浏览器 Web（非 Desktop App）
  When：渲染 Auto discovery 区域
  Then：`IP scan (advanced)` 仍展示为一行折叠项（浏览器端的“局域网扫描”入口）
- Given：用户点击 `Show`
  When：展开 `IP scan (advanced)`
  Then：显示 CIDR 输入框与 `Scan` 按钮，且两者高度一致
  And：在 header 行提供文本链接 `Hide` + `tabler:chevron-up`（不使用按钮样式）
- Given：UI 运行在 Desktop App 且服务发现开启后 30 秒内没有发现任何新设备（device 列表无新增），且用户尚未手动展开
  When：到达 30 秒阈值
  Then：自动展开 `IP scan (advanced)`，并提示用户可尝试手动输入 CIDR 进行扫描

### Auto discovery：不可用/空态

- Given：UI 运行在浏览器 Web（非 Desktop App）
  When：modal 打开
  Then：左侧展示“mDNS 服务发现仅 Desktop App 支持”的提示与使用建议
  And：`IP scan (advanced)` 可用（用户输入 CIDR 后可扫描）
  And：右侧 Manual add 不受影响，可正常创建设备
- Given：UI 运行在 Desktop App 且 discovery provider 出错/不可用
  When：modal 打开或用户点击 `Refresh`
  Then：左侧展示“Discovery unavailable”的原因与重试建议
  And：右侧 Manual add 不受影响，可正常创建设备
- Given：服务发现 10 秒内未发现任何设备
  When：渲染 Auto discovery 区域
  Then：展示空态（No devices found）与 `Refresh` 按钮，并提示用户检查同网段/设备上电
- Given：用户在 “IP scan（advanced）” 中输入 CIDR 并点击 `Scan`
  When：扫描进行中
  Then：展示可见进度与取消入口；扫描完成后把命中的设备合并进 discovery 列表（并按去重规则标记 Added）
- Given：UI 运行在浏览器 Web，且用户拒绝/被策略阻止 PNA 权限（表现为 preflight blocked / network error）
  When：用户发起 IP scan
  Then：左侧给出可读提示（例如“需要允许 Local network access / Private network access”）与排障建议
  And：右侧 Manual add 不受影响，可正常创建设备

## 非功能性验收 / 质量门槛（Quality Gates）

### Web

- `cd web && bun run check`
- `cd web && bun run test:unit`（新增：discovery 状态机/去重/“带入”逻辑的单测）
- `cd web && bun run test:e2e`（新增：打开 Add device modal、断言两列与关键文案存在；覆盖 “mDNS Desktop only + IP scan 可用” 分支）
- `cd web && bun run build`

## 文档更新（Docs to Update）

- `docs/plan/0006:web-ui-screens-and-theme/PLAN.md`: 在 Add device 小节标注“Add device 交互已由 Plan #0007 扩展”（仅口径提醒；实现阶段再决定是否更新 #0006 mockup 文件）。
- `README.md`: 在 Web 使用说明中补充“如何发现设备/何时需要手动添加”的简短指引（实现完成后）。

## 参考效果（References）

- 本计划高保真效果图：`./references/mockups/README.md`
- 视觉与 modal 规则基线：Plan #0006 mockups（`docs/plan/0006:web-ui-screens-and-theme/references/mockups/add-device.svg`）
- 设备身份字段来源：Plan #0005（`GET /api/v1/info`）

## 里程碑（Milestones）

- [ ] M1: Web：落地 Add device modal（两列布局 + Manual add 不回归）
- [ ] M2: Web：落地 Auto discovery UI（mDNS Desktop only 提示/列表/去重/带入 + IP scan 高级区块 UI）
- [ ] M3: Web：补齐 unit/e2e（Modal/带入/去重/mDNS Desktop only + IP scan）
- [ ] M4: 文档：更新 README（Desktop App 自动发现说明 + Web 手动添加指引）

## 与其他 Plan 的依赖与推进顺序（Dependencies / Order）

### Plan 关系

- 本 Plan（#0007）定义 **Add device（自动发现 + 手动添加）** 的 UI/交互与验收口径，是“体验层”的冻结基线。
- “真正的服务发现（mDNS/DNS‑SD）”需要一个**本机能力载体**：
  - **Desktop App（推荐）：Plan #0008（Tauri）** 作为 discovery 的主实现载体（Rust 后端做 mDNS/DNS‑SD）。
  - 远程 Web（GitHub Pages）：不支持 mDNS 服务发现（已冻结决策），但支持 IP scan（advanced，用户输入 CIDR）作为局域网扫描方式。

### 推荐实现顺序（进入 impl 后）

1. 先实现本 Plan（#0007）的 Web 交互与 IP scan（advanced）（用户输入 CIDR → `GET /api/v1/info` 探测，依赖 Plan #0005 的 CORS + PNA），并补齐单测/E2E。
2. 再实现 Plan #0008（Tauri Desktop App）：复用同一套 UI，并提供 mDNS/DNS‑SD 服务发现作为 Desktop 主路径。
3. 最后补齐本 Plan 的 README 指引与排障说明（含“何时用 Desktop 服务发现 / 何时用 Web IP scan / 何时手动添加”）。

## 方案概述（Approach, high-level）

- Web UI 保持 “手动添加” 为主干路径（永远可用），把 auto discovery 作为增强能力：
  - Desktop App：auto discovery 可用，提供“一键带入”（已冻结：不直接写入）
  - 远程 Web：不提供 mDNS 服务发现（显示提示），但提供 IP scan（advanced）以 `GET /api/v1/info` 探测 CIDR 内的候选设备（依赖 Plan #0005 的 CORS + PNA）
- Desktop App 的 discovery provider（Plan #0008）负责：
  - mDNS/DNS‑SD 服务发现 → `GET /api/v1/info`（Plan #0005）验证 → 输出候选设备列表
  -（可选）IP scan：由用户输入 CIDR 触发（本计划冻结 UI 与交互口径；扫描策略见 Plan #0008）

## 风险与开放问题（Risks & Open Questions）

- **浏览器权限风险（PNA）**：远程 Web 的 IP scan 依赖 Chrome/Chromium 的 PNA 预检与权限提示；用户拒绝/被策略阻止时，需要可读提示与排障建议（对齐 Plan #0005 的错误分类）。
- **本机能力风险**：Desktop App 侧的 mDNS/DNS‑SD 可靠性、多网卡、超时/重试等在 Plan #0008 中细化与验证。
- **性能与噪声风险**：IP scan 会产生较多请求，需要并发/超时/停止策略，避免对网络造成可感知干扰。
- **误判风险**：局域网内其它 HTTP 服务可能被 mDNS 浏览到；必须严格校验 `GET /api/v1/info` 的 shape（以及 `device.firmware.name` 等特征）后才纳入结果列表。

### 开放问题（需要主人决策）

None（已冻结：auto discovery 仅 Desktop App；实现细节与策略决策见 Plan #0008）

## 假设（Assumptions）

- 目标浏览器：Chrome / Chromium（与 Plan #0005 的 PNA 策略一致）。
- Discovery 结果的唯一键优先使用 `device_id`；若缺失则回退到 `baseUrl` 去重。

## 参考（References）

- Plan #0004：多设备 + Add device 基础交互骨架
- Plan #0005：`GET /api/v1/info`（设备身份字段）
- Plan #0006：DaisyUI 主题与 modal overlay 规则 + 基础 Add device mockup
- Plan #0008：Desktop：Tauri 客户端（局域网发现 + 本地网络能力）
- Browser constraints（背景资料）：
  - Direct Sockets（IWA-only）：`https://developer.chrome.com/docs/capabilities/web-apis/direct-sockets`
  - Private Network Access（权限门槛 / 站点到私网请求）：`https://developer.mozilla.org/en-US/docs/Web/Security/Private_Network_Access`
