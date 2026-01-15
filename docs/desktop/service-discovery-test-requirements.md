# Desktop service discovery (mDNS/DNS-SD) automation test requirements

## 背景

目前 Desktop（Tauri/Rust）需要在 **macOS / Windows / Linux** 上提供一致的“自动发现设备”能力：

- 通过 mDNS/DNS‑SD 浏览 `_http._tcp.local`（或项目约定的 service type）
- 解析候选设备并输出统一的 JSON shape（供 UI/CLI 使用）
- 对发现结果执行最小可用性验证：`GET /api/v1/info`

仅靠“能编译/能启动”无法保证真实网络中的 discovery 在三平台稳定工作，因此需要一套可自动化运行、可定位问题的测试机制。

## 目标 / 非目标

### Goals

- 在可控环境中自动验证三平台 discovery 的核心闭环：
  - mDNS advertisement 出现 → Desktop 发现 → 结果正确 → HTTP 可达（`/api/v1/info`）
- 测试失败时能给出足够的诊断信息（日志、网络接口摘要、错误分类），便于排障。
- 允许在 CI 受限环境下进行“可运行的最小保障”（见下文分级策略）。

### Non-goals

- 不要求 GitHub-hosted runners 100% 复现真实局域网环境（尤其是 multicast 受限时）。
- 不把固件真实硬件接入 CI 作为强制项（可作为扩展方案）。

## 约束（Constraints）

- mDNS 依赖 UDP multicast（IPv4: `224.0.0.251:5353`），云 CI 环境可能：
  - 屏蔽/限制 multicast
  - 网络命名空间隔离导致 “advertiser/consumer” 互相不可见
- 多网卡/VPN/防火墙是跨平台不确定性来源，需要测试用例覆盖“可诊断”而不是只追求成功。

## 分级交付策略（MUST）

为避免“测试永远不稳定导致 CI 全红”，将自动化测试分为两层：

1) **Layer A：可在 GitHub Actions 默认环境运行的测试（MUST）**
   - 目标：验证 discovery 代码路径不会崩溃、错误可读、输出 shape 稳定
   - 不强依赖真实 multicast 可用

2) **Layer B：真实 mDNS 端到端测试（SHOULD / 可选强制）**
   - 目标：验证跨平台真实发现闭环
   - 运行环境：推荐自托管 runner 或局域网测试机（multicast 可用、可控网卡）

## 功能需求（Requirements）

### MUST

- **统一实现**：Desktop discovery 在三平台使用同一套核心实现与同一套依赖库（当前实现为 Rust crate `mdns-sd`）。
- **可测试接口**：提供稳定的 CLI/内部入口用于测试驱动：
  - `discover --json`（已有形态）
  - 支持可控参数：`--timeout-ms`、`--service-type`、`--expect-name`（或等价能力）
- **输出契约**：discover 输出 JSON 字段在三平台一致，且包含排障所需的最小字段：
  - 发现来源（mDNS / manual / ip-scan）
  - hostname / ip / port / service instance name / txt 摘要
  - 失败时的错误分类（例如 `mdns_unavailable`, `permission_denied`, `no_multicast`, `timeout`）
- **最小 HTTP 验证**：测试在发现后必须对目标执行 `GET /api/v1/info`，并校验：
  - HTTP status=200
  - JSON 结构满足基本 schema（至少包含 `ok`/`device`/`version` 一类字段，按项目既有 API 定义）
- **诊断输出**：当发现失败或 HTTP 验证失败时，必须输出：
  - 运行平台/版本、网络接口摘要（至少列出候选接口名称与 IPv4）
  - mDNS 初始化/浏览的错误原文（不吞掉）
  - 发现阶段/验证阶段的耗时与超时原因

### SHOULD

- **确定性 advertiser**：提供一个跨平台的“测试设备模拟器”，用于发出固定 service instance + TXT：
  - TXT 里包含稳定的 `id`/`model`/`api` 等字段，便于断言
  - 同时提供本地 HTTP server，响应 `/api/v1/info`
- **隔离性**：测试用 service instance name/hostname 必须带随机后缀，避免与局域网其他设备冲突。
- **失败保全**：CI 失败时自动上传小体积 artifacts（日志/summary），用于离线排查（不上传大包）。

### COULD

- **多网卡场景覆盖**：提供用例验证“多网卡/VPN”情况下的接口选择策略与错误提示质量。
- **防火墙提示**：Windows/Linux 上若检测到可能的防火墙阻断，提示应包含可执行建议（允许 UDP 5353、允许 App 入站等）。

## 验收标准（Acceptance Criteria）

### Layer A（GitHub Actions，必须）

- 在 macOS/Windows/Linux 上运行测试入口时：
  - 不发生 panic / 进程崩溃
  - 当 mDNS 不可用或无权限时，退出码与错误分类稳定且可读
  - 输出 JSON schema 校验通过（即便 `devices=[]`）

### Layer B（真实 mDNS 端到端，建议）

在 multicast 可用的受控网络中：

- Given：测试 advertiser 正在广播一个可识别的服务实例并提供 `/api/v1/info`
  When：运行 `discover --json --timeout-ms 10000`（或等价参数）
  Then：输出至少包含该服务实例
  And：对该实例执行 `/api/v1/info` 验证成功

## 建议的实现切分（Implementation Notes）

- `test-advertiser`：建议使用 Rust 或 Bun/Node 实现，要求跨平台且无需额外系统依赖。
- `discover`：建议提供一个仅供测试用的 `--json-schema`（或内置校验）模式，降低 CI 断言复杂度。
