# Desktop：全平台支持（Windows/Linux）（#0009）

## 状态

- Status: 部分完成（2/5）
- Created: 2026-01-13
- Last: 2026-01-15

## 背景 / 问题陈述

- Plan #0008 首发只发布 macOS，但产品目标是 **全平台（macOS/Windows/Linux）** 都能使用同一套桌面能力（local UI + discovery）。
- 若不尽早把跨平台口径冻结，会导致后续在“托盘/打包/权限/网络栈”上出现平台分叉与返工。

## 目标 / 非目标

### Goals

- 在不改变 Plan #0008 的核心用户体验（Mode B：单一可执行 + localhost UI + discovery HTTP API；GUI 可选 RPC）的前提下，扩展到 Windows/Linux：
  - GUI（Tauri）可运行并复用同一套 UI（`web/` build 产物）。
  - Tray / CLI / local HTTP server 在三平台行为一致（至少可用、可诊断）。
  - mDNS/DNS‑SD discovery + `GET /api/v1/info` 验证在三平台可用（或给出平台差异的兼容策略）。
- 冻结跨平台交付口径：支持的 OS/架构、打包格式、签名策略、权限与防火墙提示、CI 构建门槛。

### Non-goals

- 不改变固件端 HTTP API（Plan #0005）契约。
- 不在本计划内实现新的 UI 功能（UI 仍以 Plan #0007/#0008 为准）；本计划聚焦“把 #0008 迁移到跨平台可交付”。
- 不在本计划内引入自动更新（auto-updater）闭环（如需要另开 plan）。

## 用户与场景（Users & Scenarios）

- Windows / Linux 用户安装桌面程序：
  - 场景 A：打开 GUI → Add device → mDNS 发现并带入（主路径）
  - 场景 B：只运行 Tray → 点击菜单 “Open UI” 用系统浏览器打开本地 UI
  - 场景 C：只用 CLI（脚本/诊断）→ `discover --json` 输出可解析结果

## 需求（Requirements）

### MUST

- 支持平台（全平台定义，需冻结）：
  - macOS（与 #0008 一致）
  - Windows（`x86_64` + `arm64`）
  - Linux（`x86_64` + `arm64`）
- 交付形态保持与 Plan #0008 一致（Mode B）：
  - 每个平台提供一个“主分发产物”（installable package 或 portable bundle）
  - 单一主可执行支持 `gui/tray/open/serve/discover`（见 #0008 `contracts/cli.md`）
  - localhost HTTP server（见 #0008 `contracts/http-apis.md`）在三平台一致可用
  - Windows 分发形式（已确认）：`msi` + portable `zip`
  - Linux 主分发形式（已确认）：`deb`
  - Linux 额外提供：portable `tar.gz`（已确认，“解压即用”）
- discovery 能力在三平台一致：
  - mDNS/DNS‑SD 发现 + `GET /api/v1/info` 验证 + 结果输出 shape 与 Plan #0007 对齐
  - IP scan（用户输入 CIDR）行为一致（不自动猜测网段）
- 诊断与可用性：
  - Windows/Linux 上对“防火墙/网络权限/多网卡”导致的失败要有可读诊断信息（至少在 UI 的 alert 中展示原因与建议）。
- CI（GitHub Actions, MUST）：
  - 必须使用 GitHub Actions 实现跨平台 CI build（覆盖 macOS/Windows/Linux），用于验证“可构建性 + 最小冒烟”。
  - 默认不得上传 installer/app bundle 等大体积文件到 Actions artifacts（CI 只做构建验证，不做分发）。
  - 如确需上传调试材料：仅允许小体积文本（log/summary），并在工作流内自动清理，确保保留时间 ≤ 1 小时（避免占用成本）。

### SHOULD

- 输出一致性：CLI 的 JSON 输出 shape 与 UI/HTTP snapshot 对齐，避免“平台不同字段不同”。

### COULD

- 提供最小的“自检命令”用于支持排障（例如打印当前监听端口、网络接口摘要、mDNS 是否可用）。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| None | - | - | - | - | - | - | 本计划不新增接口；复用 Plan #0008 的 HTTP/RPC/CLI 契约 |

## 约束与风险（Constraints & Risks）

- 平台差异：
  - Tray/menubar API 差异（Windows taskbar / Linux tray implementations 不统一）
  - 防火墙/权限（Windows Defender Firewall / Linux 发行版差异）
  - mDNS 库与系统实现差异（多网卡、VPN、休眠唤醒）
- 打包与签名：
  - Windows 代码签名与 SmartScreen
  - macOS 签名与 notarization（与 #0008 一致口径）：
    - 若无 Apple Developer Program 的 Developer ID：无法做到“公开签名（identified developer）”，只能走“用户在系统设置中放行”的可用性策略；但 **必须 ad-hoc signed**（避免“damaged/cannot be opened”类问题）
    - 若有 Developer ID：优先补齐 Developer ID signing + notarization，减少用户摩擦
  - Linux：`deb` + portable `tar.gz`（已确认）；是否额外提供其它形式见开放问题

## 验收标准（Acceptance Criteria）

### 构建与产物

- Given：GitHub Actions（或本地构建环境）
  When：构建 release
  Then：可以分别产出 macOS/Windows/Linux 的可运行产物（至少可启动）
  And：CI 默认不上传大体积 artifacts；如上传调试 artifacts，必须 ≤ 1 小时内自动清理

### 功能一致性（最小集）

- Given：Windows 或 Linux 用户安装并运行 Desktop
  When：运行 `gui`
  Then：GUI 可打开并加载本地 UI（localhost）
  And：Add device modal 结构与 Plan #0007 一致（左 discovery / 右 manual）
- Given：Windows 或 Linux 用户运行 `open`
  When：启动本地 HTTP server
  Then：系统浏览器可打开 UI 且可调用 discovery HTTP API（带 token）
- Given：Windows 或 Linux 用户运行 `discover --json`
  When：局域网中存在 ≥ 1 台设备
  Then：stdout 输出包含至少 1 条设备记录（shape 与 Plan #0007 对齐）

## 里程碑（Milestones）

- [ ] M1: 冻结平台/架构与分发策略（打包格式、签名、公证）
- [ ] M2: Windows：可构建 + GUI/HTTP server/CLI 基础可运行
- [ ] M3: Linux：可构建 + GUI/HTTP server/CLI 基础可运行
- [x] M4: 跨平台 discovery 稳定性与诊断口径补齐（多网卡/防火墙/权限）
- [x] M5: GitHub Actions CI：全平台构建与最小冒烟门槛（不上传大体积 artifacts）

## 开放问题（需要主人决策）

- Tray 体验要求：Linux 上是否允许“仅提供 CLI + open”，把 tray 作为 SHOULD/COULD？

## 假设（Assumptions）

- 首发跨平台范围以“功能可用 + 可诊断”为主，不追求所有平台体验完全一致（例如 tray 外观细节）。

## 参考（References）

- Plan #0007：Add device（自动发现 + 手动添加）UI 口径
- Plan #0008：Desktop（Mode B：localhost UI + HTTP API；Tauri 可选 RPC）
