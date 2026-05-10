# CH318T LEDD 上游链路指示与启动恢复（#6xrna）

## 状态

- Status: 部分完成（4/5）
- Created: 2026-01-28
- Last: 2026-05-10

## 背景 / 问题陈述

- 设备需要判断隔离型 USB Hub 与上游主机的通信是否有效，并在必要时通过重新连接上游 USB D+/D- 让 CH318T 上下位机链路恢复。
- `CH318T U2 LED/MODE(LEDD)` 已接到 MCU `GPIO6`，该节点同时承担模式下拉与板载 LED 指示，固件只能高阻采样。
- 上游 USB2.0 数据路径经过 `U18(CH442E)`；`U18 EN#=PU_CED`，而 `PU_CED` 由 CH318T IO2 边带映射自 MCU 侧 `GPIO36/PU_CE`。
- 本规格承接 legacy `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`。

## 目标 / 非目标

### Goals

- 用 `GPIO6/LEDD` 提供 Hub 级 `upstream_connected` 输入，并保持 active-low 语义：低电平占比足够高表示上游通信有效。
- 以饱和积分采样替代简单去抖，降低 LEDD 为 PWM、闪烁或短毛刺时的误判。
- 提供编译期默认关闭的上电上游 USB 信号恢复动作：启用时断开 `U18` 约 2 秒后恢复。
- 保持 HTTP API 对外字段稳定，继续只暴露 `hub.upstream_connected`。

### Non-goals

- 不解码 USB 数据内容、枚举阶段、速率或带宽。
- 不实现 EEPROM 持久化、HTTP 配置入口或按键配置入口。
- 不根据 LEDD 异常自动触发恢复；恢复动作仅由编译期常量控制。
- 不修改 USB-A/USB-C 下游端口现有 replug/power 行为。

## 范围（Scope）

### In scope

- 固件启动期初始化 `GPIO36/PU_CE`，默认保持低电平，让上游 CH442E 连通。
- 固件编译期开关 `UPSTREAM_BOOT_RECOVERY_ENABLED` 控制是否在启动时将 `PU_CE` 拉高约 2 秒，再拉低恢复连通。
- 固件将 `GPIO6/LEDD` 配置为高阻输入，并用积分采样生成稳定的 `hub.upstream_connected`。
- 文档更新硬件映射、极性、默认关闭策略与验证口径。

### Out of scope

- 自动 flash 或实机强制验证。
- EEPROM address/allowlist/driver 变更。
- Web UI 结构变更；现有 UI 继续消费同一个 API 字段。

## 需求（Requirements）

### MUST

- `GPIO6` 必须保持高阻输入：不输出、不上拉、不下拉。
- `LEDD` 采样必须以 `raw_low` 作为 active-low 有效样本。
- 积分器范围固定为 `0..32`；低电平样本加分，高电平样本减分。
- 积分器 `>=24` 判定 connected，`<=8` 判定 disconnected，中间区保持上一稳定状态。
- `UPSTREAM_BOOT_RECOVERY_ENABLED` 默认必须为 `false`。
- `UPSTREAM_BOOT_RECOVERY_DISCONNECT_MS` 初始必须为 `2000`。
- 默认构建必须把 `GPIO36/PU_CE` 初始化为低电平并保持上游信号连通。
- 启用恢复开关时，启动期必须先拉高 `PU_CE` 断开上游 USB 信号，等待约 2 秒后拉低恢复。

### SHOULD

- 日志应能看出启动恢复是否启用，以及 LEDD 积分状态在稳定状态变化时的分数。

### COULD

- 后续实机验证后调整断开时长。

## 接口契约（Interfaces & Contracts）

- `GET /api/v1/ports` 继续返回 `hub.upstream_connected: bool`。
- 字段语义：来自 `CH318T U2 LED/MODE(LEDD)` 的 active-low 积分采样结果；它是上游链路指示，不承诺 USB 枚举完成或速率细节。

## 验收标准（Acceptance Criteria）

- Given 默认构建
  When 固件启动
  Then `UPSTREAM_BOOT_RECOVERY_ENABLED=false`，`GPIO36/PU_CE` 初始化并保持低电平，上游 USB 信号不被启动恢复逻辑主动断开。

- Given 将编译期开关改为 `true` 的本地验证构建
  When 固件启动
  Then `GPIO36/PU_CE` 拉高约 2 秒后拉低，形成一次上游 USB 信号重新连接。

- Given `LEDD` 存在短毛刺或 PWM/闪烁
  When 积分分数保持在 `9..23`
  Then `hub.upstream_connected` 保持上一稳定状态，不快速翻转。

- Given `LEDD` 低电平占比持续足够高
  When 积分分数达到 `24`
  Then `hub.upstream_connected=true`。

- Given `LEDD` 高电平占比持续足够高
  When 积分分数降到 `8`
  Then `hub.upstream_connected=false`。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- `cargo check --bin isolapurr-usb-hub`
- `just build`

### Quality checks

- Fresh PR review proof 无待修阻塞项。
- PR checks green on latest head.

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 锁定 `LEDD -> GPIO6` 采样路径并对外暴露 `hub.upstream_connected`
- [x] M2: Web UI 消费 Hub 级上游状态字段
- [x] M3: 将 LEDD 采样升级为 active-low 饱和积分器
- [x] M4: 增加默认关闭的 `GPIO36/PU_CE` 启动恢复开关
- [ ] M5: 实机验证 2 秒断开恢复效果，并据实调整时长

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：`GPIO36/PU_CE` 到 `PU_CED` 依赖 CH318T IO2 边带映射，存在数十到数百毫秒级延迟；2 秒断开时长为初始验证值。
- 风险：`LEDD` 语义可能随 CH318T OTP 版本/工作模式变化；当前只把它作为 active-low 上游链路指示源。
- 假设：`LEDD=0` 代表上游通信有效或板载链路 LED 亮。

## 参考（References）

- `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md`
- `docs/netlist/tps-sw-checklist.md`
- `docs/datasheets/ch318t-datasheet.md`
- `src/bin/main.rs`
