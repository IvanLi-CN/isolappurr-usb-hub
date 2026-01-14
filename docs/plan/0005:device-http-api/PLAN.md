# 设备 HTTP API：双口遥测 + 端口操作（Web 对接）（#0005）

## 状态

- Status: 待实现
- Created: 2026-01-10
- Last: 2026-01-14

## 背景 / 问题陈述

- 现状：固件已具备 Wi‑Fi + mDNS + 最小 HTTP（Plan #0003，`GET /` → `Hello World`），但缺少可被 Web UI 调用的业务 API。
- 现状：Web（Plan #0004）已规划“双口 Dashboard + Replug/Power 操作”的 UI 骨架，但目前为 Mock，尚未冻结“真机对接”的接口口径。
- 需要：定义一份可实现、可测试、可持续增量演进的 **HTTP 接口契约**（固件 ↔ Web），并给出实现计划与验收标准。

## 目标 / 非目标

### Goals

- 定义 `GET/POST` 的 `/api/v1` HTTP APIs：设备信息、端口列表（遥测+状态）、端口动作（replug/power）。
- 明确跨域访问策略：CORS + Private Network Access（PNA）预检（`OPTIONS`）与必要响应头，确保 GitHub Pages Web 可访问内网设备。
- 明确目标浏览器：Chrome / Chromium（Safari 不支持，不在范围内）。
- 与既有口径对齐：
  - 端口 ID：`port_a` / `port_c`（Plan #0004）
  - 遥测单位：`voltage_mv/current_ma/power_mw`（Plan #0004；数据来源与判定规则见 Plan #0001）
  - 动作语义：Data Replug / Power On|Off（等价于 Plan #0002 的“短按重插/长按断电”能力）
- 产出可执行的里程碑与验收标准（固件 + Web），并在契约文件里冻结输入/输出与错误语义。

### Non-goals

- 不引入云端服务/用户系统；不做登录态/账号体系。
- 不在 v1 中实现 WebSocket/SSE 推送（v1 先 polling）。
- 不在本计划内实现配网流程（沿用编译期注入）。
- 不冻结“PD 输出目标调节”等高级控制（如需另开 Plan）。

## 用户与场景（Users & Scenarios）

- 主人/协作者在同一局域网中打开 GitHub Pages 站点，为设备填写 `baseUrl`（如 `http://<hostname>.local` 或 `http://<ipv4>`）后查看双口遥测并执行 Replug/Power 操作。
- 调试：快速确认设备在线、预检/CORS 是否正常、端口是否 busy、遥测是否合理。

## 需求（Requirements）

### MUST

- API 版本化：所有业务 API 均在 `/api/v1/...` 下；`GET /` 继续保留（Plan #0003 的可达性基线，不在本计划内改变其语义）。
- 统一错误返回 envelope（见契约文档 `./contracts/http-apis.md`）。
- 支持 CORS + PNA：
  - 对 `GET/POST` 响应返回 `Access-Control-Allow-Origin` 等必要 CORS 头；
  - 支持 `OPTIONS` 预检（含 `Access-Control-Request-Private-Network: true`）并返回 `Access-Control-Allow-Private-Network: true`；
  - 支持 Chrome PNA permission prompt 所需 `Private-Network-Access-ID` / `Private-Network-Access-Name` 响应头（细节见契约文档）。
  - CORS 策略（冻结）：线上 allowlist `https://isolapurr.ivanli.cc`；本地 dev（`http://localhost:*` / `http://127.0.0.1:*`）允许反射 `Origin` 以便开发。
- 端口与遥测：
  - 至少提供 `port_a`（USB‑A）与 `port_c`（USB‑C/PD）两口；
  - 遥测字段 `voltage_mv/current_ma/power_mw` 与状态 `status`，并提供 `sample_uptime_ms`（无 RTC 时不依赖 ISO8601）。
- 端口动作：
  - `replug`：触发 Data Replug，busy 时返回 `409 busy`；
  - `power`：支持显式设定 on/off（幂等）；busy 时返回 `409 busy`。
- Web 对接：
  - Dashboard 单次刷新以 `GET /api/v1/ports` 为唯一入口（减少请求数）；
  - UI 能区分 `offline` / `preflight blocked` / `api error` / `busy` 并给出可读提示。

### SHOULD

- `GET /api/v1/info` 返回足够的设备身份信息用于多设备识别（`device_id/hostname/fqdn/mac` 等）。
- API 响应使用 `Cache-Control: no-store`，避免缓存导致“看起来不更新”。
- CORS 策略采用 allowlist（Pages + 本地 dev）而不是无条件反射所有 `Origin`。

### COULD

- 增加 `capabilities` 字段以适配未来 hardware variant 差异（某些动作/遥测可能不可用）。
- `replug` 可选支持 `disconnect_ms` 覆盖（默认沿用 Plan #0002 的断开时长；仅在需要时开放）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Device HTTP APIs (`/api/v1/...`) | HTTP API | external | New | ./contracts/http-apis.md | Firmware | Web | 含 CORS/PNA 预检与错误语义 |

### 契约文档（按 Kind 拆分）

- [contracts/README.md](./contracts/README.md)
- [contracts/http-apis.md](./contracts/http-apis.md)

## 验收标准（Acceptance Criteria）

### 固件 API（局域网内可用）

- Given：固件启用 `net_http`，设备已联网并获得 IPv4
  When：访问 `http://<hostname>.local/` 或 `http://<ipv4>/`
  Then：`GET /` 返回 `200` 与 `Hello World`（作为连通性基线）
- Given：浏览器从 HTTPS 页面（`https://isolapurr.ivanli.cc/`）发起跨域请求
  When：对任一 `/api/v1/*` 发起带 `Origin` 的请求，并触发 `OPTIONS` 预检（含 `Access-Control-Request-Private-Network: true`）
  Then：预检响应包含必要的 CORS 头与 `Access-Control-Allow-Private-Network: true`，并包含 `Private-Network-Access-ID/Name`（见契约）
- Given：设备在线
  When：`GET /api/v1/ports`
  Then：返回包含 `port_a` 与 `port_c` 的列表，遥测字段单位正确，且字段缺失/错误能用 `status` 表达
- Given：端口处于 `busy=false`
  When：`POST /api/v1/ports/<portId>/actions/replug`
  Then：返回 `202`（或 `200`），并在短时间内 `GET /api/v1/ports` 里可观察到 `replugging` 状态切换
- Given：端口处于 `busy=true`
  When：再次触发 `replug` 或 `power` 操作
  Then：返回 `409 busy`，且 `retryable=true`

### Web（GitHub Pages 对接）

- Given：用户在 Web UI 中配置 `baseUrl=http://<hostname>.local`（或 `http://<ipv4>`）
  When：Dashboard 轮询 `GET <baseUrl>/api/v1/ports`
  Then：页面可展示双口 V/I/P（或明确的状态提示），并在设备离线/预检失败时给出可读错误
- Given：用户点击 “Replug/Power”
  When：Web 调用对应 `POST` endpoint
  Then：UI 展示 busy/禁用态，成功后状态与遥测在后续轮询中收敛一致

## 非功能性验收 / 质量门槛（Quality Gates）

### Firmware

- `cargo build --release`
- `cargo build --release --features net_http`

### Web

- `cd web && bun run check`
- `cd web && bun run build`
- 若 Plan #0004 的测试分层已落地：补齐并保持 `bun run test:*` 在 CI 中通过

## 文档更新（Docs to Update）

- `docs/networking.md`：补充 `/api/v1` 端点、CORS/PNA 预检说明、Chrome 权限提示说明与排障建议。
- `README.md`：补充“Web 连接真机”的使用说明（需要的浏览器、`baseUrl` 写法、常见错误）。
- `docs/plan/0004:github-pages-ports-dashboard/PLAN.md`：在“后续接入真实设备”处引用本计划（可选）。

## 里程碑（Milestones）

- [x] M1: 冻结接口契约与关键决策（浏览器策略/CORS 策略/Auth 策略）
- [x] M2: （impl）固件：HTTP 路由 + `/api/v1` endpoints + CORS/PNA 预检
- [x] M3: （impl）固件：对外导出端口状态与动作（replug/power）并与按键状态机一致
- [x] M4: （impl）Web：实现 DeviceClient（real mode）并替换 Mock 数据（保留 Mock fallback）
- [x] M5: （impl）联调与文档：Chrome 实测流程、常见失败场景提示、README/Networking 补齐

## 方案概述（Approach, high-level）

- 固件侧采用“最小可控”的 HTTP router：
  - 解析 request line + 必需 headers（`Origin`、`Access-Control-Request-*`、`Content-Length`（如需要））；
  - `OPTIONS` 统一走预检分支；
  - `/api/v1/*` 输出 `application/json`，统一错误 envelope；
  - CORS 策略：线上 allowlist `https://isolapurr.ivanli.cc`；本地 dev（`http://localhost:*` / `http://127.0.0.1:*`）反射 `Origin`；对允许的 `Origin` 回显 `Access-Control-Allow-Origin`（并设置 `Vary: Origin`）。
- 固件侧对外数据以“快照（snapshot）”形式提供：
  - 主循环/采样域维护 `latest_ports_snapshot`；
  - HTTP task 仅读取快照并写入“动作请求”（command），避免在 HTTP 上下文直接碰硬件外设。
- Web 侧以 polling 为主：
  - 周期性 `GET /api/v1/ports` 更新 UI；
  - 触发动作使用 `POST`，并在 busy 时禁用按钮（或展示 toast）。

## 风险与开放问题（Risks & Open Questions）

- **浏览器兼容性风险**：PNA 的实现与策略会随 Chrome 版本演进；permission prompt / `targetAddressSpace` 等行为需以目标 Chrome 版本实测为准。
- **安全风险**：v1 未鉴权（已确认接受局域网误触发风险）；如需加固（token/鉴权）应另开 Plan 以避免破坏 v1 兼容性。
- **资源开销**：JSON 生成、请求解析、并发连接会带来 RAM/CPU 负担；需在实现阶段评估并给出上限策略（例如限制并发为 1、限制响应大小、限速）。
- **硬件差异**：不同 hardware variant 的“端口能力/动作副作用”（尤其 USB‑C 断电影响范围）可能不同；需要通过 `capabilities` 或文档明确。

## 开放问题（需要主人决策）

None（本计划范围已冻结）：

- 目标浏览器：Chrome / Chromium only。
- CORS：线上 allowlist `https://isolapurr.ivanli.cc`；本地 dev 允许反射 `Origin`。
- Auth：none。
- 端口范围：仅 `port_a` / `port_c`。

## 假设（Assumptions）

None。

## 参考（References）

- Plan #0001：双口遥测口径（USB‑A/U13 与 USB‑C/U17，mV/mA/mW）
- Plan #0002：端口动作语义（Data Replug / Power On|Off，busy/拒绝策略）
- Plan #0003：Wi‑Fi + mDNS + 最小 HTTP 基线（`net_http`）
- Plan #0004：GitHub Pages Dashboard（PortId/字段单位/UI 交互骨架）
- `docs/networking.md`：当前联网能力说明（后续需补齐 API 与 PNA 说明）
