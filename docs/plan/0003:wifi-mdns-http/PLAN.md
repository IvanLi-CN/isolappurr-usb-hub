# 固件联网：Wi‑Fi + mDNS + HTTP（Hello World）（#0003）

## 状态

- Status: 待实现
- Created: 2026-01-09
- Last: 2026-01-09

## 背景 / 问题陈述

- 现状：当前设备无法接入局域网，无法通过好记的地址被发现与访问。
- 目标：让固件具备 Wi‑Fi STA 联网能力，并通过 mDNS 提供 `.local` 主机名解析与 HTTP 服务发现。
- 参考：优先复用成熟项目 `loadlynx` 的网络栈与 mDNS 经验，降低试错成本。

## 目标 / 非目标

### Goals

- 设备可通过 Wi‑Fi STA 接入局域网，获得 IPv4（默认 DHCP；支持可选静态 IPv4）。
- 设备提供稳定不冲突的 `.local` 主机名：`<hostname>.local`。
- 设备通过 mDNS 同时提供：
  - 主机名解析（A 记录 / ANY 查询）→ 当前 IPv4
  - HTTP 服务发现（`_http._tcp.local` 的 PTR/SRV/TXT）
- 设备提供 HTTP 服务：访问根路径 `/` 返回可验证的 `Hello World`。
- 主流系统尽量可用；当 `.local`/mDNS 不可用时，提供本机屏幕显示 IPv4 作为兜底：
  - 同时按住左右键 3 秒后，界面显示 IP/hostname 信息（若未联网则显示 “no ip” 等可测试提示）。

### Non-goals

- 不做配网流程（AP/Captive Portal/蓝牙/串口交互配网等）；Wi‑Fi 参数暂时按“固件写死/编译期注入”。
- 不做 HTTPS、鉴权、用户系统、云端接入。
- 不引入完整 Web UI（后续如需可另开 Plan）；本计划仅交付最小 HTTP 可达性与发现能力。

## 用户与场景（Users & Scenarios）

- 用户希望在同一局域网中，用手机/电脑通过一个稳定地址访问设备：
  - `http://<hostname>.local/` 直接打开（或先解析 `<hostname>.local` 再访问 IP）。
- 同时存在多台同型号设备时，应当能自然去冲突并可区分实例（基于 MAC 派生 short id）。
- 当局域网/系统环境对 mDNS 支持不佳时，用户可通过设备屏幕查看 IP 继续访问。

## 范围（Scope）

### In scope

- Wi‑Fi STA：连接、掉线重连、获取 IPv4（DHCP/静态）。
- Hostname：
  - 默认从设备 MAC 派生 short id，形成稳定 hostname（示例：`isolapurr-usb-hub-<shortid>`）。
  - `<hostname>.local` 为最终可解析的 FQDN。
- mDNS（IPv4）：
  - 监听并加入 `224.0.0.251:5353` 组播。
  - 响应 A/ANY 查询，提供 hostname → IPv4。
  - 发布 `_http._tcp.local`：支持常见的“浏览/列举 + 解析”的服务发现路径（PTR/SRV/TXT）。
- HTTP server（最小）：
  - `GET /` 返回 `200` 与正文 `Hello World`（内容与 Content-Type 在实现阶段冻结为常量）。
- UI/交互（最小）：
  - 同时按住左右键 `>= 3s` → 显示网络信息页/overlay（hostname、IPv4、可选网关/DNS）。

### Out of scope

- IPv6 / mDNS over IPv6（本阶段仅 IPv4）。
- 服务端多路由、多页面、静态资源托管、WebSocket 等。
- Wi‑Fi 省电策略、漫游策略与复杂网络环境适配（后续按实际需求再扩展）。

## 需求（Requirements）

### MUST

- Wi‑Fi STA 能连接到指定 SSID（WPA2‑PSK），并能在断线后按策略自动重连。
- DHCP 模式下：在可接受的超时内获取 IPv4；失败进入可观测的错误状态并持续重试。
- 静态 IPv4（可选）：
  - 若配置提供 `ip/netmask/gateway`，则使用静态配置并仍可选配置 DNS。
- mDNS：
  - 设备加入组播组并绑定 UDP 5353，响应到达的查询包。
  - 对 `<hostname>.local` 的 A/ANY 查询返回当前 IPv4（含 cache-flush 标志）。
  - 对 `_http._tcp.local` 的浏览/解析请求提供必要记录（PTR/SRV/TXT）。
- HTTP：
  - `GET /` 返回 `200`，正文包含 `Hello World`（用于验收与后续扩展基线）。
- UI：
  - 双键长按 3 秒触发一次“显示网络信息”动作；显示内容可读且可测试。

### SHOULD

- 网络功能通过 Cargo feature gate 控制，避免影响非联网固件构建与资源占用评估。
- 对 mDNS 编解码等纯逻辑部分增加 host 可运行的单元测试（`#[cfg(test)]` + `extern crate std`）。
- Wi‑Fi 参数以编译期注入方式提供（`.env` → `build.rs` → `env!()/option_env!()`），便于开发期快速迭代。

### COULD

- mDNS 额外提供服务实例名称（instance name）的人类可读信息（如包含设备型号与 short id）。
- 在 UI 网络信息页增加 “RSSI/连接状态” 等诊断字段。

## 验收标准（Acceptance Criteria）

- **联网与状态可观测**
  - Given：固件内已有正确的 SSID/PSK（以及可选静态 IPv4 参数）
  - When：刷入启用网络 feature 的固件并上电
  - Then：设备在合理超时内进入 `Connected`，获得 IPv4；日志与 UI 可显示 hostname 与 IPv4
- **mDNS 主机名解析（A/ANY）**
  - Given：设备已连接且拥有 IPv4
  - When：同一局域网客户端解析 `<hostname>.local`
  - Then：解析结果等于设备当前 IPv4（支持组播响应；若请求方要求单播响应，也能正确响应）
- **mDNS HTTP 服务发现**
  - Given：设备已连接且 HTTP server 处于可监听状态
  - When：同一局域网客户端浏览 `_http._tcp.local`
  - Then：可看到设备的服务实例；解析后可得到正确的目标 hostname/port（SRV）与附加信息（TXT 最小集合即可）
- **HTTP 根路径**
  - Given：设备已连接
  - When：客户端访问 `http://<hostname>.local/`
  - Then：返回 `200`，响应体包含 `Hello World`
- **掉线恢复**
  - Given：设备处于已连接状态
  - When：AP 断开/信号丢失导致掉线后恢复网络
  - Then：设备可自动重连并再次获得 IPv4；mDNS 与 HTTP 恢复可用（必要时重新公告）
- **屏幕兜底显示 IP**
  - Given：设备上电运行
  - When：同时按住左右键 `>= 3s`
  - Then：
    - 若已获得 IPv4：界面显示 hostname、IPv4（可选显示网关/DNS）
    - 若未联网：界面显示可测试的 `NO IP`（或等价文案），且不会影响后续联网流程

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests（host）：
  - mDNS：hostname 派生规则（MAC→short id→hostname→FQDN）
  - mDNS：A/PTR/SRV/TXT 的基础编码与查询解析（最少覆盖“带/不带 unicast-response 位”）
- Integration tests（实机）：
  - DHCP/静态 IPv4 两条路径至少验证其一；掉线恢复一次
- E2E（跨平台）：
  - macOS/Linux：`<hostname>.local` 解析 + `curl http://<hostname>.local/`
  - 额外平台尽量覆盖 Windows（如环境具备 Bonjour/mDNS 支持），否则以“屏幕显示 IP + 直连 IP 访问”作为最低保障

### Quality checks

- Firmware：`cargo build --release`（保持 `no_std` 约束不被破坏）
- Web（如本次变更未触及）：不强制，但建议在合并前保持 `cd web && bun run check && bun run build` 通过

## 文档更新（Docs to Update）

- `README.md`：增加“网络功能（Wi‑Fi/mDNS/HTTP）”章节：配置方式（`.env`/编译期注入）、hostname 规则、如何访问、如何在屏幕查看 IP
- `docs/`：增加一份短文档（例如 `docs/networking.md`）：mDNS/服务发现支持矩阵、已知限制与排障命令

## 里程碑（Milestones）

- [x] M1: 冻结范围与验收标准（Wi‑Fi STA + mDNS 主机名 + `_http._tcp` 服务 + `GET /` + 双键显示 IP）
- [ ] M2: （impl）网络栈接入：Wi‑Fi STA + DHCP/静态 IPv4 + 连接状态机（参考 `loadlynx`）
- [ ] M3: （impl）mDNS：A/ANY + `_http._tcp.local` PTR/SRV/TXT（含周期性 announce 与重连处理）
- [ ] M4: （impl）HTTP：最小 server（`GET /` → `Hello World`），并与网络栈/并发模型对齐
- [ ] M5: （impl）UI：双键长按 3 秒显示网络信息；未联网时给出明确提示
- [ ] M6: （impl）单元测试 + 实机验收（至少 macOS/Linux + 一条掉线恢复路径）
- [ ] M7: （impl）文档补齐与示例命令（README + networking doc）

## 方案概述（Approach, high-level）

- 总原则：最大化复用 `loadlynx` 的网络栈组合与组织方式，减少“在 ESP32 Rust 网络栈上重新发明轮子”的风险。

### 网络栈选型（对齐参考实现）

- 参考 `loadlynx` 组合：
  - Wi‑Fi：`esp-radio`（含 Wi‑Fi 驱动与设备抽象）
  - 运行时：`esp-rtos`（提供调度/与 embassy 集成）
  - IP 栈：`embassy-net` + `smoltcp`
- 本项目实现阶段将以 feature gate 方式引入，避免影响非联网固件。

### Wi‑Fi 参数（编译期注入，先写死）

- 使用 `.env`（不入库）或环境变量注入：
  - `USB_HUB_WIFI_SSID`（必填）
  - `USB_HUB_WIFI_PSK`（必填）
  - `USB_HUB_WIFI_HOSTNAME`（可选；默认按 MAC 派生）
  - `USB_HUB_WIFI_STATIC_IP/NETMASK/GATEWAY/DNS`（可选）
- `build.rs` 读取 `.env` 并导出为 `cargo:rustc-env=...`，固件侧通过 `env!()/option_env!()` 使用（参考 `loadlynx/firmware/digital/build.rs`）。

### Hostname 与发现

- Hostname 默认规则：
  - `short_id = hex(mac[3..6])`（6 字符）
  - `hostname = "isolapurr-usb-hub-" + short_id`
  - `fqdn = hostname + ".local"`
- mDNS：
  - 复用 `loadlynx/firmware/digital/src/mdns.rs` 的“join multicast + UDP 5353 + query parse + response build”骨架。
  - 扩展记录集：在满足 A 记录的基础上补齐 PTR/SRV/TXT，以支持 `_http._tcp.local` 的服务发现。

### HTTP server（最小形态）

- 先做“可验证基线”：
  - 只保证 `GET /` 200 + `Hello World`
  - 其余路径返回 `404`
  - 并发策略与连接数限制在实现阶段明确（优先不追求高并发，保证稳定与可观测）

### UI（双键显示网络信息）

- 同时按住左右键 3 秒触发一次显示动作：
  - 已联网：显示 hostname 与 IPv4（必要时分页/滚动或专用信息页）
  - 未联网：显示 `NO IP`（并可显示当前 Wi‑Fi 状态：Connecting/Error）
- 注意避免与 `GPIO0` 启动模式风险耦合：仅在运行态识别该手势，不建议在复位/上电阶段按住。

## 风险与开放问题（Risks & Open Questions）

- **资源开销风险**：Wi‑Fi + TCP/IP + mDNS + HTTP 可能显著增加 RAM/Flash 占用；需在实现阶段评估并给出可接受边界。
- **跨平台差异**：Windows 对 `.local`/mDNS 支持依赖环境；以“屏幕显示 IP + 直连 IP”作为最低保障路径。
- **网络设备过滤组播**：部分 AP/交换机可能限制 mDNS；需要在文档中给出排障提示与 fallback。

## 假设（Assumptions）

- HTTP 服务端口默认 `80`；mDNS 发布 `_http._tcp.local` 指向该端口。
- 若未显式提供 `USB_HUB_WIFI_HOSTNAME`，hostname 使用默认派生规则（含 short id），以避免同网段冲突。

## 参考（References）

- 参考项目（网络栈与 mDNS 骨架）：`https://github.com/IvanLi-CN/loadlynx`
  - `firmware/digital/src/net.rs`（Wi‑Fi + embassy-net wiring）
  - `firmware/digital/src/mdns.rs`（mDNS responder：A/ANY）
  - `firmware/digital/build.rs`（.env → 编译期注入）
