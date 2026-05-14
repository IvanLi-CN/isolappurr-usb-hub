# CH318T LEDD 上游链路指示（#6xrna）

## 状态

- Status: 完成
- Created: 2026-01-28
- Last: 2026-05-11

## 背景 / 问题陈述

- 设备需要判断隔离型 USB Hub 与上游主机的通信是否有效。
- `CH318T U2 LED/MODE(LEDD)` 已接到 MCU `GPIO6`，该节点同时承担模式下拉与板载 LED 指示，固件只能高阻采样。
- CH318T 数据手册把 `LED/MODE` 描述为模式配置脚和下行口 LED/LINK 指示脚，没有给出 PWM 占空比或闪烁协议要求。
- 新硬件不再通过 MCU `GPIO36/PU_CE` 控制上游 CH442E 通断；上游 USB 信号路径由硬件直接连接。
- 本规格承接 legacy `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`。

## 目标 / 非目标

### Goals

- 用 `GPIO6/LEDD` 提供 Hub 级 `upstream_connected` 输入，并保持 active-low 语义：低电平表示上游链路有效或 LED 亮。
- 以普通 GPIO 输入低频采样替代积分采样，降低固件复杂度。
- 保持 HTTP API 对外字段稳定，继续只暴露 `hub.upstream_connected`。

### Non-goals

- 不解码 USB 数据内容、枚举阶段、速率或带宽。
- 不实现 EEPROM 持久化、HTTP 配置入口或按键配置入口。
- 不根据 LEDD 异常自动触发恢复。
- 不由固件驱动 `GPIO36/PU_CE` 或控制已移除的上游 CH442E 通断路径。

## 范围（Scope）

### In scope

- 固件将 `GPIO6/LEDD` 配置为高阻输入。
- 固件每秒读取一次 `LEDD`，并以 `raw_low` 直接更新 `hub.upstream_connected`。
- 文档更新硬件映射、极性、采样策略与验证口径。

### Out of scope

- 自动 flash 或实机强制验证。
- EEPROM address/allowlist/driver 变更。
- Web UI 结构变更；现有 UI 继续消费同一个 API 字段。

## 需求（Requirements）

### MUST

- `GPIO6` 必须保持高阻输入：不输出、不上拉、不下拉。
- `LEDD` 采样必须以 `raw_low` 作为 active-low 有效样本。
- 固件必须以低频轮询方式采样 `LEDD`，当前采样周期为 `1000ms`。
- `hub.upstream_connected` 必须直接反映最近一次 `LEDD` 采样结果。
- 固件不得再初始化或保持 `GPIO36/PU_CE` 电平。

### SHOULD

- 仅在采样结果变化时输出调试日志，避免每秒刷屏。

## 接口契约（Interfaces & Contracts）

- `GET /api/v1/ports` 继续返回 `hub.upstream_connected: bool`。
- 字段语义：来自 `CH318T U2 LED/MODE(LEDD)` 的 active-low 低频采样结果；它是上游链路指示，不承诺 USB 枚举完成或速率细节。

## 验收标准（Acceptance Criteria）

- Given 默认构建
  When 固件启动
  Then `GPIO36/PU_CE` 不被固件初始化或驱动。

- Given `LEDD=Low`
  When 经过一次 1 秒采样周期
  Then `hub.upstream_connected=true`。

- Given `LEDD=High`
  When 经过一次 1 秒采样周期
  Then `hub.upstream_connected=false`。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- `cargo check --bin isolapurr-usb-hub`
- `USB_HUB_WIFI_SSID=test USB_HUB_WIFI_PSK=testpassword cargo check --bin isolapurr-usb-hub --features net_http`
- `just build`

### Quality checks

- Fresh PR review proof 无待修阻塞项。
- PR checks green on latest head.

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 锁定 `LEDD -> GPIO6` 采样路径并对外暴露 `hub.upstream_connected`
- [x] M2: Web UI 消费 Hub 级上游状态字段
- [x] M3: 将 LEDD 采样简化为 active-low 1 秒 GPIO 采样
- [x] M4: 移除固件对 `GPIO36/PU_CE` 的接管

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：`LEDD` 语义可能随 CH318T OTP 版本/工作模式变化；当前只把它作为 active-low 上游链路指示源。
- 假设：`LEDD=0` 代表上游通信有效或板载链路 LED 亮。
- 假设：CH318T `LED/MODE` 在本应用中是普通 LED/LINK 逻辑指示，不需要 PWM 积分采样。

## 参考（References）

- `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`
- `docs/netlist/tps-sw-checklist.md`
- `docs/datasheets/ch318t-datasheet.md`
- `src/bin/main.rs`
