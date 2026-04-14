# SW2303 高压 PPS PDO 缺失定位与修复（#jqapx）

## 状态

- Status: 部分完成（3/4）
- Created: 2026-04-14
- Last: 2026-04-14

## 背景 / 问题陈述

- 当前固件已经在启动期对 `SW2303` 应用 full profile，但现场仍观察到 PPS PDO 只到 `11V`，看不到更高压档位。
- 现有日志只能证明“执行过初始化”，不能明确回答 `PPS2(3.3~16V)`、`PPS3(3.3~21V)` 是否真的被启用，也不能区分是仓库侧配置错误、驱动语义缺口，还是外部线材/源端限制。
- 如果继续在无证据的状态下调协议参数，容易把问题从“定位不足”扩大成“策略漂移”。

## 目标 / 非目标

### Goals

- 建立本问题的 canonical spec，冻结复现条件、诊断门与收口标准。
- 让固件在 boot/recovery 后能够输出可复核的 SW2303 PD/PPS 能力快照，直接回答 PPS 是否支持 `>11V`。
- 修正仓库侧对 SW2303 PPS 配置语义的误用，避免把“启用 PPS”误映射成“切到寄存器配置模式”。
- 若当前驱动缺少结构化状态接口，则把最小必要接口补到本仓库可复现的本地 vendor 依赖里，并用测试锁住语义。

### Non-goals

- 不改 `TPS55288` 的功率调节策略。
- 不引入新的外部控制接口、UI 或网络行为。
- 不在没有 owner-confirmed 串口/设备条件下伪造真机结论。

## 范围（Scope）

### In scope

- `SW2303` 的 PD/PPS 配置语义校正。
- 结构化 PD/PPS capability 读回接口。
- 固件 boot/recovery 诊断日志增强。
- 本地构建与驱动回归测试。

### Out of scope

- 与 PPS 问题无关的快充协议策略重写。
- 远程控制、持久化配置、额外调试壳层。
- 未具备硬件条件时的实机刷写与 Source Cap 实测结论。

## 需求（Requirements）

### MUST

- 必须能从日志或结构化状态明确回答：
  - `PPS2(3.3~16V)` 是否启用；
  - `PPS3(3.3~21V)` 是否启用；
  - `REG 0xB4 bit7` 当前是 `Auto` 还是 `Register` 模式。
- 必须把“PPS enable”与“PPS register-config mode”拆成两个独立语义，禁止继续复用同一布尔字段表达两者。
- 固件业务路径不得重新引入 raw register 读写依赖。
- 回归测试必须覆盖“启用 PPS 但保持 Auto mode”这一语义，防止再次退回错误映射。

### SHOULD

- 结构化状态应同时带出 fixed PDO 与 PPS ranges，便于直接判断是否支持 `>11V`。
- 日志应输出一个直接结论位，例如 `pps_above_11v=true/false`。

### COULD

- 在后续具备硬件条件时，沿用同一诊断输出做实机对照验收。

## 功能与行为规格（Functional/Behavior Spec）

### Core flows

- 启动期应用 SW2303 full profile 后，固件立即以 best-effort 方式读取结构化 PD/PPS capability snapshot；读回成功时输出：
  - PD 是否启用；
  - PPS mode（`Auto` / `Register`）；
  - fixed PDO 使能集合；
  - PPS0/1/2/3 使能集合；
  - `pps_max_mv` 与 `pps_above_11v`。
- 运行期遇到 SW2303 I2C 恢复并重试 profile 后，继续以同样的 best-effort 方式输出 capability snapshot，保证 boot/recovery 两条路径口径一致。
- `full profile` 默认应保持 `PPS` 处于 `Auto` 模式，除非后续明确实现并写入一整套寄存器驱动的 PPS profile。

### Edge cases / errors

- 若 capability snapshot 读回因瞬时 I2C 错误失败，不得把整次 profile 应用判定为失败；应保留初始化成功，并额外输出“诊断读回不可用”的告警。
- 若 capability snapshot 显示 `pps_enabled=true` 但 `pps_above_11v=false`，日志必须明确标成异常诊断结论，而不是只打印原始位集。
- 若实机仍看不到 `>11V PPS PDO`，但结构化读回已确认 `PPS2/PPS3` 启用，则该轮根因归类应转向外部约束，而不是继续修改协议位。

## 接口契约（Interfaces & Contracts）

### 接口清单（Inventory）

| 接口（Name） | 类型（Kind） | 范围（Scope） | 变更（Change） | 契约文档（Contract Doc） | 负责人（Owner） | 使用方（Consumers） | 备注（Notes） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sw2303::PdConfiguration` | Rust type | internal | Modify | None | firmware | firmware / local vendor driver tests | 拆分 `pps_enabled` 与 `pps_config_mode` |
| `sw2303::PpsConfigMode` | Rust type | internal | New | None | firmware | firmware / local vendor driver tests | 明确 `Auto` vs `Register` |
| `sw2303::PdCapabilityStatus` | Rust type | internal | New | None | firmware | firmware / local vendor driver tests | 提供 fixed/PPS ranges 与 mode 读回 |
| `SW2303::get_pd_capability_status()` | Rust API | internal | New | None | firmware | repo firmware | 结构化诊断入口 |
| `EnableProfileStatus.pd_capabilities` | Rust type field | internal | Modify | None | firmware | repo firmware | boot/recovery 日志依赖（best-effort readback） |

### 契约文档（按 Kind 拆分）

- None

## 验收标准（Acceptance Criteria）

- Given 当前 full-profile 初始化路径执行成功
  When 固件打印 SW2303 profile 诊断日志
  Then 日志中能明确看到 `pps_config_mode`、`pps_ranges`、`fixed_voltages`、`pps_max_mv` 与 `pps_above_11v`。

- Given `PdConfiguration { pps_enabled: true, pps_config_mode: Auto, ... }`
  When 驱动写入并读回 PD capability status
  Then `PPS2` 与 `PPS3` 必须保持启用，且 `pps_above_11v=true`。

- Given 后续实机仍看不到 `>11V PPS PDO`
  When capability snapshot 显示 `pps_ranges[2] || pps_ranges[3] == true`
  Then 该轮结论必须归类为“外部约束或观测链问题”，禁止误报“仓库侧仍未启用高压 PPS”。

## 实现前置条件（Definition of Ready / Preconditions）

- 问题已冻结为“高压 PPS PDO 缺失”，而不是泛化的 SW2303 初始化问题。
- 允许在仓库内 vendor 当前 `sw2303-rs` 依赖并补最小必要接口。
- 真机验收可以晚于代码/测试落地，但不得虚构完成状态。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: `cargo test --manifest-path vendor/sw2303-rs/Cargo.toml --tests`
- Integration tests: None
- E2E tests (if applicable): 真机 Source Cap / PPS 观察，待硬件条件具备后执行

### Quality checks

- `cargo check --bin isolapurr-usb-hub`
- `just build`

## 文档更新（Docs to Update）

- `docs/specs/README.md`: 新增本 spec index 行并跟踪状态
- `docs/specs/jqapx-sw2303-pps-high-voltage-pdo/SPEC.md`: 作为本问题唯一 canonical contract

## 计划资产（Plan assets）

- Directory: `docs/specs/jqapx-sw2303-pps-high-voltage-pdo/assets/`
- In-plan references: `![...](./assets/<file>.png)`
- Visual evidence source: maintain `## Visual Evidence` in this spec when owner-facing or PR-facing screenshots are needed.

## Visual Evidence

## 资产晋升（Asset promotion）

- None

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 冻结 canonical spec 与收口标准
- [x] M2: 在本地 vendor `sw2303-rs` 中补齐结构化 PD/PPS capability 状态接口与回归测试
- [x] M3: 固件 boot/recovery 路径输出结构化 PPS 诊断，并默认保持 PPS `Auto` mode
- [ ] M4: 在同一套现场观测路径上完成真机对照，确认 `>11V PPS PDO` 恢复或归因到外部约束

## 方案概述（Approach, high-level）

- 先把“PPS enable”与“PPS register-config mode”从类型层拆开，避免仓库侧再次误写 `REG 0xB4 bit7`。
- 再提供结构化 `PdCapabilityStatus`，让固件日志依赖结构化读回而不是 raw flags。
- 最后用 vendor driver tests 锁住位语义，并把固件日志改成直接回答“是否支持 >11V PPS”。

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：若 SW2303 硬件/线材/源端对高压 PPS 仍有限制，代码修复后现场现象可能不立即变化。
- 需要决策的问题：无；当前先按仓库侧配置语义修复推进。
- 假设（需主人确认）：后续真机验收会沿用当前同一套 PDO 观测方法与设备。

## 变更记录（Change log）

- 2026-04-14: 首版 spec，冻结“高压 PPS PDO 缺失”问题边界与修复口径。

## 参考（References）

- `src/pd_i2c/sw2303.rs`
- `src/bin/main.rs`
- `vendor/sw2303-rs/docs/SW2303_寄存器手册__Release_RG013_1_v1.4.md`
- `docs/sw2303-init-enable-profile.md`
