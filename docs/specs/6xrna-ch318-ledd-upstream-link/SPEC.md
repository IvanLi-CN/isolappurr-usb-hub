# CH318T 隔离侧 USB 状态指示（#6xrna）

## 状态

- Status: 完成
- Created: 2026-01-28
- Last: 2026-05-14

## 背景 / 问题陈述

- 设备需要判断隔离侧 USB 下行端口是否连接，以及隔离侧 USB 链路是否 ready。
- `CH318T U2 IO1(UP0_PG)` 已接到 MCU `GPIO18`，外部 `100kΩ` 上拉到 `3V3`，低电平表示隔离侧下行端口连接。
- `CH318T U2 LED/MODE(LEDD)` 已接到 MCU `GPIO6`，该节点同时承担模式下拉与板载 LED 指示，低电平表示隔离侧 USB ready/link，固件只能高阻采样。
- CH318T 数据手册把 `LED/MODE` 描述为模式配置脚和下行口 LED/LINK 指示脚，没有给出 PWM 占空比或闪烁协议要求。
- 新硬件不再通过 MCU `GPIO36/PU_CE` 控制上游 CH442E 通断；上游 USB 信号路径由硬件直接连接。
- 本规格承接 legacy `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`。

## 目标 / 非目标

### Goals

- 用 `GPIO18/UP0_PG` 提供 Hub 级 `isolated_downstream_connected` 输入，并保持 active-low 语义：低电平表示隔离侧 USB 下行端口已连接。
- 用 `GPIO6/LEDD` 提供 Hub 级 `isolated_usb_ready` 输入，并保持 active-low 语义：低电平表示隔离侧 USB ready/link 或 LED 亮。
- 保持 HTTP API 对外兼容，继续暴露 `hub.upstream_connected` 作为旧客户端别名，值等于 `hub.isolated_usb_ready`。
- 以普通 GPIO 输入低频采样替代积分采样，降低固件复杂度。

### Non-goals

- 不解码 USB 数据内容、枚举阶段、速率或带宽。
- 不实现 EEPROM 持久化、HTTP 配置入口或按键配置入口。
- 不根据 LEDD 异常自动触发恢复。
- 不由固件驱动 `GPIO36/PU_CE` 或控制已移除的上游 CH442E 通断路径。

## 范围（Scope）

### In scope

- 固件将 `GPIO6/LEDD` 配置为高阻输入。
- 固件将 `GPIO18/UP0_PG` 配置为高阻输入。
- 固件每秒读取一次 `LEDD`，并以 `raw_low` 直接更新 `hub.isolated_usb_ready` 与兼容字段 `hub.upstream_connected`。
- 固件每秒读取一次 `UP0_PG`，并以 `raw_low` 直接更新 `hub.isolated_downstream_connected`。
- 文档更新硬件映射、极性、采样策略与验证口径。

### Out of scope

- 自动 flash 或实机强制验证。
- EEPROM address/allowlist/driver 变更。
- Web UI 结构变更；现有 UI 继续消费同一个 API 字段。

## 需求（Requirements）

### MUST

- `GPIO6` 必须保持高阻输入：不输出、不上拉、不下拉。
- `GPIO18` 必须保持高阻输入：不输出、不上拉、不下拉。
- `LEDD` 采样必须以 `raw_low` 作为 active-low 有效样本。
- `UP0_PG` 采样必须以 `raw_low` 作为 active-low 有效样本。
- 固件必须以低频轮询方式采样 `LEDD`，当前采样周期为 `1000ms`。
- 固件必须以低频轮询方式采样 `UP0_PG`，当前采样周期为 `1000ms`。
- `hub.isolated_usb_ready` 与 `hub.upstream_connected` 必须直接反映最近一次 `LEDD` 采样结果。
- `hub.isolated_downstream_connected` 必须直接反映最近一次 `UP0_PG` 采样结果。
- 固件不得再初始化或保持 `GPIO36/PU_CE` 电平。

### SHOULD

- 仅在采样结果变化时输出调试日志，避免每秒刷屏。

## 接口契约（Interfaces & Contracts）

- `GET /api/v1/ports` 与 USB JSONL `ports.get` 继续返回 `hub.upstream_connected: bool`，并新增 `hub.isolated_downstream_connected: bool` 与 `hub.isolated_usb_ready: bool`。
- `hub.upstream_connected` 是兼容字段，值必须等于 `hub.isolated_usb_ready`。
- `hub.isolated_downstream_connected` 字段语义：来自 `CH318T U2 IO1(UP0_PG)` 的 active-low 低频采样结果，表示隔离侧 USB 下行端口连接状态。
- `hub.isolated_usb_ready` 字段语义：来自 `CH318T U2 LED/MODE(LEDD)` 的 active-low 低频采样结果，表示隔离侧 USB ready/link，不承诺 USB 枚举完成或速率细节。

## 验收标准（Acceptance Criteria）

- Given 默认构建
  When 固件启动
  Then `GPIO36/PU_CE` 不被固件初始化或驱动。

- Given `LEDD=Low`
  When 经过一次 1 秒采样周期
  Then `hub.isolated_usb_ready=true` 且 `hub.upstream_connected=true`。

- Given `LEDD=High`
  When 经过一次 1 秒采样周期
  Then `hub.isolated_usb_ready=false` 且 `hub.upstream_connected=false`。

- Given `UP0_PG=Low`
  When 经过一次 1 秒采样周期
  Then `hub.isolated_downstream_connected=true`。

- Given `UP0_PG=High`
  When 经过一次 1 秒采样周期
  Then `hub.isolated_downstream_connected=false`。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- `cargo check --bin isolapurr-usb-hub`
- `USB_HUB_WIFI_SSID=test USB_HUB_WIFI_PSK=testpassword cargo check --bin isolapurr-usb-hub --features net_http`
- `just build`
- `cd web && bun run check && bun run build && bun run build-storybook`

### Quality checks

- Fresh PR review proof 无待修阻塞项。
- PR checks green on latest head.

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 锁定 `LEDD -> GPIO6` 采样路径并对外暴露 `hub.upstream_connected`
- [x] M2: Web UI 消费 Hub 级上游状态字段
- [x] M3: 将 LEDD 采样简化为 active-low 1 秒 GPIO 采样
- [x] M4: 移除固件对 `GPIO36/PU_CE` 的接管
- [x] M5: 新增 `UP0_PG -> GPIO18` 采样路径与隔离侧状态字段

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：`LEDD` 语义可能随 CH318T OTP 版本/工作模式变化；当前只把它作为 active-low 隔离侧 USB ready/link 指示源。
- 假设：`LEDD=0` 代表隔离侧 USB ready/link 或板载链路 LED 亮。
- 假设：`UP0_PG=0` 代表隔离侧 USB 下行端口已连接。
- 假设：CH318T `LED/MODE` 在本应用中是普通 LED/LINK 逻辑指示，不需要 PWM 积分采样。

## 参考（References）

- `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`
- `docs/netlist/tps-sw-checklist.md`
- `docs/datasheets/ch318t-datasheet.md`
- `src/bin/main.rs`
