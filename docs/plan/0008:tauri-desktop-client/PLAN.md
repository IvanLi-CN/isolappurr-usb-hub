# Desktop：Tauri 客户端（局域网发现 + 本地网络能力）（#0008）

## 状态

- Status: 已完成
- Created: 2026-01-13
- Last: 2026-01-18

## 背景 / 问题陈述

- 我们需要在“用户不知道设备 IP/hostname”的情况下，仍能快速把设备添加到 UI 中。
- “真正的服务发现（mDNS/DNS‑SD）”在**纯网页**环境不可行（缺少原生 UDP/multicast 能力；浏览器也无法可靠读取本机网卡/网段信息），因此已冻结为：**自动发现仅在 Desktop App 中支持**；Browser Web 只保留手动添加（见 Plan #0007）。
- 因此增加一个 **Tauri Desktop App**：以桌面客户端承载同一套 UI，并使用客户端的原生网络能力在本机完成 mDNS/DNS‑SD（主路径）与可选 IP scan（fallback）。
- 进一步目标：同一个“桌面本机程序”同时支持 GUI / Tray / CLI 三种入口；其中 CLI 与 Tray 使用**系统浏览器**打开同一套 UI，因此程序需要内置 **localhost HTTP server** 来服务内嵌的 web 资产，并提供 discovery 的 HTTP 接口（Tauri 可选用 RPC）。

## 目标 / 非目标

### Goals

- 交付一个可实现、可测试的“桌面本机能力”方案（以同一套 discovery core 支撑多个前端形态）：
  - 复用现有 `web/` UI（包含 Plan #0006 的主题规范与 Plan #0007 的 Add device modal 交互）。
- 在 Rust 侧实现局域网服务发现（mDNS/DNS‑SD）与可选 IP scan（fallback），并把结果提供给前端（Tauri IPC 为主）。
- Desktop App 中的 Add device 体验与 Plan #0007 的高保真稿一致（布局、状态机、空态/错误态、IP scan 折叠/30s 自动展开等）。
- Discovery 结果仍以 `GET /api/v1/info`（Plan #0005）进行验证与字段补全，避免误识别局域网内其它 HTTP 服务。

### 交付形态（Delivery modes）

> 目标：同一套 discovery core，支持 3 种“入口/体验”形态；最终用户通常只会用其中一种，发布策略应尽量避免“装了不用的东西”。

- CLI：用于诊断/脚本化发现（一次性输出、或启动/停止后台发现）。
- Menubar/Tray：只有状态栏菜单（无主窗口或默认不弹窗），提供“发现状态 + 快速添加入口/打开 UI”。
- GUI（Tauri）：完整桌面应用（主窗口 + 复用 `web/` UI），提供最完整体验（主路径：mDNS/DNS‑SD）。

### Non-goals

- 不取代 GitHub Pages Web：Web 仍保留“手动添加”能力；**auto discovery 不在纯 Web 支持（已冻结决策）**，见 Plan #0007。
- 不在本计划中引入“自动更新（auto-updater）”的产品级闭环（若需要，另开 plan）。
- 不在本计划中改变固件侧网络行为（mDNS service type 之类的变更另行计划）。
- 不把本地 HTTP server 绑定到 `0.0.0.0` 或对外网卡（仅 `127.0.0.1` / `::1`），不提供“局域网内其他设备访问此 UI”能力（若需要，另开 plan 并补安全策略）。

## 用户与场景（Users & Scenarios）

- 桌面用户（macOS/Windows/Linux，具体范围见开放问题）在同一局域网打开 Desktop App：
  - 场景 A：不知道 IP/hostname，依赖 mDNS/DNS‑SD 一键发现并添加
  - 场景 B：已知 `baseUrl`，立即手动输入并添加（不等待 discovery）
  - 场景 C：同网段多台设备，列表滚动/过滤/去重/“Added” 状态提示

## 需求（Requirements）

### MUST

- 发布与形态（冻结：Mode B，一个软件包搞定）：
  - 发布为**一个软件包**（例如 macOS `.app`）；包含**一个主可执行文件**，通过参数/子命令支持 `gui` / `tray` / `cli` 三种模式（见 `./contracts/cli.md`）。
  - CLI 与 Tray 模式使用系统浏览器打开同一套 UI（由本地 HTTP server 提供）。
  - 默认启动形态（已确认）：`gui`（用户双击 `.app` 默认打开 GUI）。
- macOS 签名与 Gatekeeper（MUST，首发可用性门槛）：
  - 现实约束：若没有 Apple Developer Program 的 **Developer ID** 证书，则无法做到“系统识别的公开签名（identified developer）”与 notarization。
  - 首发（无开发者账号）交付策略（已确认，MUST）：
    - macOS 构建产物必须进行 **ad-hoc signing**（`codesign -s -`），避免出现“App is damaged / cannot be opened”等因缺少签名导致的失败（尤其是包含内嵌 framework/webview 组件时）。
    - ad-hoc signing 仅用于完整性与运行时要求，不等价于“identified developer”，Gatekeeper 仍可能拦截首次运行。
    - 必须提供“首次运行引导/排障文档”：当被 Gatekeeper 阻止时，用户可以在 **System Settings → Privacy & Security** 中 `Open Anyway`（或 Finder 右键 `Open`）来允许运行。
    - 必须提醒：仅对“可信来源（本项目发布）”执行该操作；并解释风险（用户可能在下载到被篡改版本时误放行）。
  - 未来（有开发者账号后）升级策略（不影响本计划实现顺序）：
    - 采用 Developer ID signing + notarization，使用户无需手动放行即可直接打开应用。
- 本地 HTTP server（给 Web UI 用，MUST）：
  - 绑定：仅 `127.0.0.1` / `::1`。
  - 责任：
    - 服务内嵌的 UI 静态资源（`web/dist` 打包进应用资源；SPA fallback）。
    - 提供 discovery 的 HTTP API（供系统浏览器内的 UI 调用），见 `./contracts/http-apis.md`。
  - 安全：
    - 仅允许同源 UI 访问 API；所有 `/api/v1/*` 必须携带 token（避免其他网站触发扫描/刷新）。
    - 默认不启用跨域 CORS（无需对外网站开放）。
  - 端口策略（已确认：高位端口 + 未指定时可自动选择）：
    - 若用户通过 `--port` 指定：使用该端口；若被占用则报错并退出（避免用户以为“用了 A 端口”但实际跑在 B 端口）。
    - 若未指定：自动选择一个可用的**高位端口**（默认范围：`51200–51299`），并把最终 `agentBaseUrl` 回显给用户（CLI）/用于打开浏览器（Tray）。
    - 为减少“端口变化导致浏览器存储丢失”的风险：若未指定端口，程序应优先复用上一次成功启动的端口（持久化保存），仅在端口被占用时才自动换一个新的可用端口。
- GUI（Tauri）：
  - 使用 Tauri 承载桌面窗口；默认加载本地 HTTP server 的 UI（减少前端分支）。
  - 允许 Tauri 通过 RPC 直接调用 discovery（可选，见 `./contracts/rpc.md`），但**HTTP API 必须存在**以支撑系统浏览器 UI。
- 服务发现（主路径）：
  - 由 Rust 后端在本机执行 mDNS/DNS‑SD 浏览与解析，得到候选 hostname/port。
  - 对候选执行 `GET http://<host>/api/v1/info`（Plan #0005）验证并补全字段后，才输出给 UI。
  - UI 使用 Plan #0007 的 `Auto discovery` 交互（含去重与“带入”规则）。
- IP scan（fallback）：
  - 仍遵守 Plan #0007 的原则：**不自动开始扫描**；仅在用户点击 `Scan` 后发起 IP scan。
  - Desktop App 可基于本机网卡信息提供候选 CIDR 并预填默认值（Plan #0013），但不触发扫描。
  - Desktop App 允许提供“基于本机网卡推导的建议范围”作为输入辅助，但必须要求用户显式确认（见开放问题）。
- 安全边界（最小暴露）：
  - Desktop App 不对外暴露“任意网站可调用的 HTTP API”，默认仅限 app 内 IPC。
  - 如果未来要支持“浏览器 UI 连接到 Desktop App 提供的 discovery”，必须另开接口契约与安全策略（origin allowlist / token 等）。
- CI（GitHub Actions, MUST）：
  - 必须有 GitHub Actions 的 CI build（首发至少覆盖 macOS），用于验证 Desktop 与 Web 资产可构建。
  - macOS CI 产物必须执行 ad-hoc signing，并至少完成一次 `codesign --verify`（不要求通过 notarization / `spctl` 评估）。
  - 默认不得上传 `.app` / installer / `web/dist` 等大体积文件到 Actions artifacts（CI 只做构建验证，不做分发）。
  - 如确需上传调试材料：仅允许小体积文本（log/summary），并在工作流内自动清理，确保保留时间 ≤ 1 小时（避免占用成本）。

### SHOULD

- 统一数据形状：Tauri IPC 返回的设备结构与 Plan #0007 的 UI domain shape 对齐（`DiscoveredDevice` / `DiscoverySnapshot`，见 `docs/plan/0007:add-device-discovery/contracts/ui-components.md`），减少前端分支。
- 支持增量更新：服务发现结果支持“新增即推送”，前端无需高频轮询（可用 Channel）。
- 明确的诊断信息：当 mDNS 不可用/网络异常时，UI 显示可读原因（例如“同网段不通/设备未上电/请求超时”）。

### COULD

- 提供“仅运行 discovery 后台（无 UI）”的模式（sidecar 或 tray）以服务浏览器端（作为后续计划的候选）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Desktop local HTTP APIs | HTTP API | external | New | ./contracts/http-apis.md | Desktop | System browser UI / CLI | 服务 UI + discovery API（localhost only） |
| Desktop CLI | CLI | external | New | ./contracts/cli.md | Desktop | 用户 | `gui/tray/cli` 模式与输出 |
| Tauri discovery commands | RPC | internal | New | ./contracts/rpc.md | Desktop | Tauri WebView UI | 可选：与 HTTP API 等价（或作为薄封装） |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/http-apis.md](./contracts/http-apis.md)
- [contracts/cli.md](./contracts/cli.md)
- [contracts/rpc.md](./contracts/rpc.md)

## 验收标准（Acceptance Criteria）

### Desktop App：基本能力

- Given：用户安装并打开 Desktop App
  When：进入 Devices 页面并点击 “+ Add”
  Then：出现与 Plan #0007 一致的 Add device modal（左 discovery，右 manual add）
  And：右侧 `Create` 始终可用（只受输入校验影响）

### Desktop App：服务发现（mDNS/DNS‑SD）

- Given：局域网中存在 ≥ 1 台设备（设备上电且 HTTP 可达）
  When：用户打开 Add device modal
  Then：左侧自动进入 scanning 状态，并在发现设备后展示候选列表
  And：每条候选都已通过 `GET /api/v1/info` 验证后才显示为可添加条目

### Desktop App：IP scan（fallback）

- Given：用户打开 Add device modal
  When：渲染 `IP scan (advanced)`
  Then：默认折叠，并在“30 秒无新增设备”时自动展开（对齐 Plan #0007）
- Given：用户在 `IP scan (advanced)` 输入 CIDR 并点击 `Scan`
  When：扫描进行中
  Then：UI 展示可见进度与取消入口，并在完成后把命中设备合并到列表

### CI（GitHub Actions）

- Given：提交 PR 或 push 到主分支
  When：GitHub Actions 运行 Desktop CI
  Then：至少完成 `web` build 与 Desktop build（macOS）
  And：macOS 产物已执行 ad-hoc signing，且 `codesign --verify` 通过（不要求 notarization / `spctl` 通过）
  And：不上传大体积 artifacts；如上传调试 artifacts，必须 ≤ 1 小时内自动清理

## 非功能性验收 / 质量门槛（Quality Gates）

### Desktop

- `cargo check` / `cargo build`（Tauri app）
- 端到端冒烟：打开 app → 打开 Add device modal → 至少验证 UI 结构与 IPC 调用路径（实现阶段补齐脚本/步骤）

### Web（复用既有门槛）

- `cd web && bun run check`
- `cd web && bun run build`

### CI（GitHub Actions）

- 触发：`pull_request` / `push` / `workflow_dispatch`
- 门槛：Desktop build + `web` build 必须通过
- artifacts：默认不上传大文件；如上传调试材料，仅允许小体积文本且需 ≤ 1 小时内自动清理

## 文档更新（Docs to Update）

- `README.md`：补充 Desktop App 的安装/运行入口（实现完成后）
- `docs/plan/0007:add-device-discovery/PLAN.md`：已冻结“auto discovery 仅 Desktop App 支持”；实现后补充 Desktop App 入口与排障说明

## 里程碑（Milestones）

- [x] M1: 冻结交付形态（CLI/Tray/GUI）、平台范围、分发/安全边界与 RPC 契约
- [x] M2: 搭建 Tauri app 骨架并复用 `web/` UI
- [x] M3: 实现 mDNS/DNS‑SD discovery（含 `GET /api/v1/info` 验证）并通过 localhost API 输出（可选 RPC）
- [x] M4: 接入 Plan #0007 的 UI 状态机 + 基本冒烟验证 + 使用说明
- [x] M5: GitHub Actions CI：macOS build + 门槛校验（不上传大体积 artifacts）

## 与 Plan #0007 的关系（Dependency）

- 本 Plan（#0008）提供 “Add device → Auto discovery” 的**本机能力实现**（mDNS/DNS‑SD、可选 IP scan、可选网卡信息），用于补足纯浏览器环境缺失的 UDP/multicast 能力。
- UI/交互口径以 Plan #0007 为准；实现阶段应优先复用 #0007 的组件形状与验收标准，避免 Desktop 与 Web 体验分裂。

## 方案概述（Approach, high-level）

- Code organization（建议）：
  - `discovery-core`（Rust lib）：mDNS/DNS‑SD + `GET /api/v1/info` 验证 +（可选）IP scan
  - `desktop-gui`（Tauri）：复用 `web/` UI，通过 IPC 调用 `discovery-core`
  - `desktop-cli`：复用 `discovery-core`，面向终端输出（human/JSON）
  - `desktop-tray`：复用 `discovery-core`，只提供状态栏/托盘入口（可选）
- UI：复用现有 Web UI（React + Tailwind + DaisyUI），在 GUI（Tauri）中以 WebView 承载；保持“手动添加”永远可用。
- Discovery：由 Rust 侧执行 mDNS/DNS‑SD 浏览与候选验证（`GET /api/v1/info`），通过 IPC（GUI）或本进程调用（CLI/Tray）输出候选设备列表。
- Browser Web：不依赖本计划提供的“本地代理”；按 Plan #0007 的口径，仅提供 **IP scan（用户输入 CIDR）+ 手动添加**。

## 风险与开放问题（Risks & Open Questions）

### 资源占用（Resource footprint, measured）

> 目的：用于决定“一个软件包搞定”是否会造成明显浪费。以下数据为 **macOS arm64** 上的本机测量（release build，Tauri v2）。

- 基线测量（最小模板，不含本项目 UI 与 discovery 依赖）：
  - Tauri GUI（create-tauri-app `vanilla`, Tauri `2.9.5`）：
    - `tauri2-vanilla.app` ≈ `8.3 MB`
    - 主二进制 `tauri2-vanilla` ≈ `8.2 MB`
  - Rust CLI（`cargo new` hello-world）：
    - `rust-cli-size-test` ≈ `0.4 MB`
- 结论（定性）：
  - 如果我们**已经要发 GUI（Tauri）**：把 CLI/Tray 作为额外产物一起打到同一个安装包里，通常只增加“几个 MB 级别”的磁盘体积（主要取决于 discovery 依赖与是否复用同一二进制）。
  - 运行时内存主要取决于“用户实际运行的模式”：CLI/Tray 不启动 WebView 时，常驻内存显著低于 GUI；把三种模式放在同一包里并不会强制占用额外内存。

- 平台与分发：
  - 首发平台（已确认）：macOS（跨平台支持见 Plan #0009）
  - 发布策略（已确认）：Mode B（一个安装包 + 一个主可执行；通过子命令支持 `gui/tray/open/serve/discover`）
  - 签名/公证（macOS notarization）：
    - 若无 Developer ID：按上文“首次运行引导/排障”策略交付（允许用户在系统设置中放行）
    - 若有 Developer ID：实现阶段再补齐 signing + notarization（避免首发被 Gatekeeper 拦截）
- 技术选型：
  - Rust mDNS/DNS‑SD 库选择与兼容性（需要在实现阶段验证稳定性与多网卡场景）。
  - 服务发现的 mDNS 过滤策略（已确认默认，与固件一致）：
    - 浏览 `_http._tcp.local`，并对候选执行 `GET /api/v1/info` 验证
    - 可选增强：未来固件额外发布专用 service type（更干净，但需要改固件；如要做建议另开 plan），Desktop 可同时支持双策略
  - IPC 形态：轮询（简单）vs Channel 推送（更顺滑）。
- 体验策略：
  - 已实现：从本机网卡推导 CIDR 作为候选，并预填默认值（Plan #0013；仍要求用户点击 `Scan` 才开始）。
  - IP scan 的 CIDR 校验与防误用策略（已确认：允许任意 CIDR，但避免误扫/大范围扫描）：
    - 允许任意 CIDR 输入（不以 RFC1918 范围限制）
    - 当预计扫描目标数较大时，必须二次确认并提示风险；并发/超时要有上限（实现阶段确定默认值）
  - 外部站点访问（已确认）：不允许外部网站连接 Desktop local HTTP API（不启用 CORS；仅同源 localhost UI 可用）

### Mode B 细节（已确认 / 默认）

- 默认启动形态：`gui`
- 端口策略：高位端口；未指定时自动选择并尽量复用上次端口（默认范围 `51200–51299`；最终值以 `agentBaseUrl` 为准）
- API 安全：采用 `Authorization: Bearer <token>`；token 由 `GET /api/v1/bootstrap` 提供给同源 UI（对外站点无 CORS）

## 假设（Assumptions）

- Desktop App 首发：macOS（跨平台支持见 Plan #0009）。
- 设备识别仍以 `device_id` 作为主键，缺失时回退到 `baseUrl` 去重（对齐 Plan #0007）。

## 参考（References）

- Plan #0005：设备身份字段：`GET /api/v1/info`
- Plan #0007：Add device（自动发现 + 手动添加）的 UI/验收/高保真稿
- Tauri IPC（commands / channels）：
  - `https://tauri.app/learn/sidecar-nodejs/`
  - `https://tauri.app/develop/calling-frontend/`
