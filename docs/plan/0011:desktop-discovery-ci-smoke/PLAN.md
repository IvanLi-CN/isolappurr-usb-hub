# Desktop：CI discovery 流程测试（跨平台 smoke）（#0011）

## 状态

- Status: 待实现
- Created: 2026-01-15
- Last: 2026-01-15

## 背景 / 问题陈述

- 当前 Desktop 的 CI 更偏向“可构建性验证”，对 discovery 这条核心链路（mDNS → 候选 → `GET /api/v1/info` 校验 → 去重合并 → 输出/诊断）缺少可重复、可断言的跨平台测试。
- 由于公有 runner 的 multicast 环境不稳定，若把真实 mDNS 广播作为 PR gate，很容易产生 flaky；但完全不测会导致回归静默进入主干。

## 目标 / 非目标

### Goals

- 在 GitHub Actions 的 `windows-latest` / `ubuntu-24.04` / `macos-14` 上提供确定性的 discovery smoke 流程测试，覆盖核心链路与关键失败路径。
- 将“服务发现不回归（至少 smoke 级）”纳入 Desktop 的质量门槛：失败可诊断、流程不崩溃、fallback（IP scan / manual add）仍可继续。

### Non-goals

- 不把“真实 multicast mDNS 广播”作为 PR gate 的 MUST（可作为非阻断信心补强）。
- 不做 GUI 级端到端自动化（点击/截图/窗口自动化）。
- 不在 CI 中上传大体积 artifacts（遵守 Plan #0009 的成本约束）。

## 用户与场景（Users & Scenarios）

- Desktop（Tauri/agent）在三平台运行时：
  - 场景 A：mDNS resolved 事件到达 → 通过 `GET /api/v1/info` 验证后进入候选列表
  - 场景 B：局域网存在“非本设备”的 HTTP 服务 → 被过滤且可诊断
  - 场景 C：同一设备重复被发现 → 按 `device_id`（优先）/`baseUrl` 规则去重合并
  - 场景 D：mDNS 不可用（初始化失败/被禁用/系统不支持）→ 不崩溃，给出可读提示，IP scan/manual add 仍可用

## 范围（Scope）

### In scope

- 覆盖对象：`desktop/src-tauri` 的 discovery 核心链路：
  - 发现输入（可注入/可模拟的 resolved 事件）
  - HTTP 校验（对候选发起 `GET /api/v1/info`，仅校验通过的设备进入结果）
  - 去重/合并（优先 `device_id`，否则 `baseUrl`；合并规则以当前实现为准并在测试中冻结）
  - 输出通道（至少覆盖一种：`discover --json` 或 `GET /api/v1/discovery/snapshot`）
  - 失败可诊断（提示信息可读；流程不崩溃；fallback 可继续）
- CI 覆盖平台：`windows-latest`、`ubuntu-24.04`、`macos-14`（不要求 arm64 runner）。

### Out of scope

- 依赖真实 multicast 网络环境的稳定性验证（可做非阻断补强，但不作为 MUST gate）。
- 分发产物/签名/安装包上传（仍以 Plan #0009 的口径为准）。

## 需求（Requirements）

### MUST

- 提供“假设备”HTTP 服务（仅用于测试）：
  - 绑定 `127.0.0.1`（仅 loopback）。
  - 实现 `GET /api/v1/info`，返回能被现有解析逻辑识别的 JSON（至少包含 firmware.name=`isolapurr-usb-hub` 与可选的 `device_id/hostname/fqdn/wifi.ipv4`）。
- 提供“发现输入注入”能力（确定性，不依赖 multicast）：
  - 在测试进程中向 discovery 核心注入“resolved”事件（含 `hostname/port/ipv4` 等字段），触发与真实 resolved 同一条处理路径（至少共享“候选 URL 生成 → HTTP 校验 → 去重合并”逻辑）。
- 提供 headless 执行入口（至少一种）：
  - `cargo test`：在测试中直接驱动 discovery 并断言“输出列表/diagnostics”。
- 覆盖并断言以下用例（跨平台同一套断言）：
  1. 正例发现：注入 1 个 resolved → `/api/v1/info` 返回 200 且 JSON 合法 → 结果包含该设备
  2. 过滤非设备：注入 resolved 但 `/api/v1/info` 非 2xx 或 JSON 不合法/不可识别 → 结果不包含该条目
  3. 去重：同一 `device_id` 多次 resolved（含字段差异）→ 结果仅 1 条且合并规则符合当前实现
  4. 超时收敛：限定时间内未产生有效设备 → 流程结束且不挂死（空结果允许）
  5. mDNS 不可用降级：discovery 后端不可用/初始化失败 → 程序不崩溃，产生可读诊断信息（UI 的 snapshot.error 或 CLI 输出），且 agent 基础能力（IP scan/manual add 所需）仍可运行

### SHOULD

- PR gate 至少在 macOS 上运行；在 Plan #0009 的 Win/Linux build 通过后，扩展到 Win/Linux（同一套测试同一套断言）。
- 失败日志必须足够定位问题：候选摘要、HTTP 状态/错误摘要、过滤原因、超时原因、是否进入降级。

### COULD

- 增加“真实 mDNS 广播”非阻断测试（`workflow_dispatch`/nightly），仅做信心补强。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| discovery injection API | Internal Rust API | internal | Modify | ./contracts/internal-rust-api.md | Desktop | CI tests | 用于确定性注入 resolved 事件；不暴露到产品外部 |
| discovery snapshot semantics | HTTP API | external | Modify | ./contracts/http-apis.md | Desktop | Web UI / diagnostics | 主要补齐“不可用/降级”时的可读诊断语义 |
| `isolapurr-desktop discover` | CLI | external | Modify | ./contracts/cli.md | Desktop | 用户 / CI | smoke 流程的 headless 入口候选之一 |
| GitHub Actions desktop workflow | Config | internal | Modify | ./contracts/config.md | Desktop | CI | 增加三平台 smoke 测试步骤（默认不上传 artifacts） |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/internal-rust-api.md](./contracts/internal-rust-api.md)
- [contracts/http-apis.md](./contracts/http-apis.md)
- [contracts/cli.md](./contracts/cli.md)
- [contracts/config.md](./contracts/config.md)

## 验收标准（Acceptance Criteria）

- Given：任一平台 GitHub Actions runner
  When：运行 discovery 流程测试
  Then：测试在超时内结束且满足以下断言：
  - 正例：结果包含“假设备”（且该设备必须经过 `GET /api/v1/info` 校验路径）
  - 过滤：无效候选不会出现在结果中（非 2xx / JSON 不合法 / firmware 不匹配）
  - 去重：重复发现仅产生 1 条结果（以 `device_id` 为 key；否则 fallback 到 `baseUrl`）
  - 超时：无有效输入时不挂死（空结果允许）
  - 降级：mDNS 不可用时不崩溃且有可读提示（并且 agent 可继续响应 IP scan/manual add 相关能力）

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Desktop tests（新增）：
  - `cd desktop && cargo test`（包含本计划的 discovery 流程 smoke tests）
  - 约束：单平台总耗时建议 ≤ 60s；不依赖 multicast；服务仅监听 loopback
- 复用既有门槛（不新增工具）：
  - `cd web && bun run check`
  - `cd web && bun run build`

### Quality checks

- Rust：沿用仓库既有 `cargo` 构建/测试流程（不引入新 lint 工具）。

## 文档更新（Docs to Update）

- `.github/workflows/desktop.yml`：增加三平台流程测试步骤（实现阶段落地）。
- `desktop/README.md`：补充本地如何运行 discovery smoke tests 与常见失败排障（实现阶段落地）。
- `docs/plan/0009:desktop-cross-platform-support/PLAN.md`：若本计划成为 PR gate 的一部分，需在 #0009 的 CI 门槛中引用/对齐（如需）。

## 里程碑（Milestones）

- [ ] M1: 冻结 smoke 测试策略（注入形状、断言口径）与契约增量
- [ ] M2: 补齐可注入 discovery 后端 + 假设备 HTTP server（loopback）+ 核心用例（1–3）
- [ ] M3: 补齐“超时收敛/降级可诊断”用例（4–5）并稳定化日志
- [ ] M4: GitHub Actions：PR gate 先 macOS；Win/Linux 构建可用后扩展到三平台 +（可选）非阻断真实 mDNS 补强工作流

## 方案概述（Approach, high-level）

- 确定性优先：将“resolved 事件输入”抽象为可注入源（测试用），由生产 mDNS 后端转译并复用同一处理路径（候选 URL 生成 → HTTP 校验 → 去重合并）。
- 假设备服务：测试内启动仅 loopback 的 HTTP server，严格控制返回值以覆盖成功/失败/坏 JSON/非本设备 firmware 等路径。
- 可诊断：补齐关键点的日志与错误摘要（候选 → http 状态/错误 → 过滤原因 → 超时/降级原因），CI 只输出文本日志/summary。
- 与 Plan #0009 协同：本计划的三平台 gate 需要 Desktop 能在三平台构建；若当前仍未满足，则按里程碑拆分推进（先 macOS，再扩展到 Win/Linux）。

## 风险与开放问题（Risks & Open Questions）

- 风险：
  - 三平台构建现状若尚未稳定（见 Plan #0009），会阻塞“同一套测试在三平台做 PR gate”。
  - 过度依赖时间窗口/睡眠可能引入 flaky；需要通过可注入事件源 + 明确的 `timeout` 设计来消除不确定性。
- 需要决策的问题：见“开放问题”。

## 开放问题（需要主人回答）

- None（主人已授权由我在本计划中自行取舍并冻结口径；如后续希望调整，只需在实现前提出即可）。

## 假设（Assumptions）

- PR gate 分阶段：先在 macOS 上落地并作为 gate；待 Plan #0009 使 Win/Linux build 通过后，再扩展到 Win/Linux（同一套测试与断言）。
- headless 入口固定为 `cargo test`（确定性更强、依赖更少）。
- “超时收敛”以测试用的 discovery 驱动函数返回为准：在超时内返回（允许空结果），不要求 agent snapshot 一定进入 `ready`。
- 去重合并断言冻结到“字段级最小集合”：key 规则（`device_id` 优先，否则 `baseUrl`）+ 结果数量为 1 + `baseUrl/last_seen_at` 取最新一次通过 `GET /api/v1/info` 校验的候选。
- 降级提示以 `GET /api/v1/discovery/snapshot` 的 `error` 为 MUST；CLI stderr 可作为 SHOULD（不影响 stdout 形状）。

## 参考（References）

- Plan #0008：Desktop discovery 的 HTTP/CLI/RPC 契约与形态边界
- Plan #0009：跨平台与 CI 成本约束（不上传大体积 artifacts）
- `desktop/src-tauri/src/main.rs`：当前 discovery 处理路径（resolved → validate → merge → snapshot）
- `.github/workflows/desktop.yml`：当前 Desktop CI 工作流
