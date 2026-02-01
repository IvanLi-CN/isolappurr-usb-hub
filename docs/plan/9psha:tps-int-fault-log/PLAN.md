# TPS55288 故障中断（INT_TPS）：仅在异常变化时打印（#9psha）

## 状态

- Status: 待实现
- Created: 2026-02-01
- Last: 2026-02-01

## 背景 / 问题陈述

- tps-sw 硬件上预留了 `INT_TPS`（MCU `GPIO38`），用于接收 TPS55288 `FB/INT` 的故障指示（active-low，板上 4.7k 上拉到 `3V3`）。
- 现有固件通过 1Hz 轮询读取 TPS `STATUS` 并打印 `diag:`，信息冗余且会反复清除故障位（`STATUS` 读后清除），不利于快速定位“瞬态故障/边沿变化”。

## 目标 / 非目标

### Goals

- 使用 `INT_TPS(GPIO38)` 的边沿中断，在**故障相关状态发生变化时**尽快打印 TPS 异常信息。
- 移除与该目标无关的周期性 `diag:` 打印（避免刷屏与掩盖关键信息）。

### Non-goals

- 不改变 TPS55288 的保护策略/阈值（OCP/SCP/OVP 等配置不在本计划范围内）。
- 不引入新的日志系统或持久化故障记录机制（仅做“更快、更干净的变化日志”）。

## 范围（Scope）

### In scope

- 固件：配置 `GPIO38(INT_TPS)` 为高阻输入，并启用 GPIO 中断（`AnyEdge`）。
- 固件：在 `INT_TPS` 电平或 TPS `STATUS`（`FaultStatus`）变化时，打印一条短日志（包含 `INT` 电平 + `OperatingStatus` + `FaultStatus`）。
- 固件：删除 1Hz `diag:` 打印（以及其中对 TPS `STATUS` 的周期性读取）。

### Out of scope

- 变更 SW2303 轮询策略、UI 刷新策略、或其它非 TPS 故障相关日志。

## 验收标准（Acceptance Criteria）

- Given 固件运行在 `tps-sw` 且 `INT_TPS(GPIO38)` 有效  
  When `INT_TPS` 发生边沿（low/high）  
  Then 固件应在下一次主循环 tick 内（≤ 50ms 量级）打印一次 TPS 状态日志，且仅在状态变化时打印。

- Given TPS55288 出现 `SCP/OCP/OVP` 任意故障（STATUS 位被置位）  
  When 故障触发或解除  
  Then 日志应能看到对应 `FaultStatus` 的变化（不依赖 1Hz 周期性 `diag:`）。

- Given 正常运行且无 TPS 故障变化  
  Then 日志中不应再出现周期性 `diag:` 行（避免无关刷屏）。

## 验证（Testing）

- Build: `cargo build --release`
- Build (feature): `cargo build --release --features net_http`

## 风险与注意事项（Risks / Notes）

- tps-sw 网表中 `FB/INT` 与 `INT_TPS` 的实际连通性取决于板上可选位（如 `R32`）；若该位未装，`INT_TPS` 将始终为高电平，此时只能依赖 I2C 读 `STATUS` 进行诊断。
- 读取 TPS `STATUS` 会清除故障位（读后清除）。本计划通过“仅在变化时读取/打印”降低对现场行为的扰动。

