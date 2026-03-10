# INA226 兼容地址 fallback（#3xckq）

## 状态

- Status: 已完成
- Created: 2026-03-11
- Last: 2026-03-11

## 背景 / 问题陈述

- 现场存在地址异常兼容件：USB-A 口的 INA226 可能在 `0x44` 应答，USB-C 口的 INA226 可能在 `0x45` 应答。
- 现有实现只尝试设计地址 `0x40` / `0x41`，会导致兼容件无法初始化，进而丢失正常界面的量测数据。
- 本规格只描述 fallback 行为本身，不重复定义正常界面的布局、格式和 present 口径；这些仍以 `docs/specs/j9twf-gc9307-normal-ui/SPEC.md` 为准。

## 目标 / 非目标

### Goals

- 为 U13 增加 `0x40 -> 0x44` fallback。
- 为 U17 增加 `0x41 -> 0x45` fallback。
- 将 fallback 严格限制在 `Address NAK` 场景。
- 确保两口地址解析彼此独立，单口失败不阻断另一口继续工作。

### Non-goals

- 修改正常界面的布局、单位格式、颜色、刷新周期。
- 修改 USB-C present 判定与 SW2303 协议激活规则。
- 修改 INA226 校准值、分流参数或功率换算公式。

## 范围（Scope）

### In scope

- `src/telemetry/hardware.rs` 中的兼容地址常量。
- `src/telemetry/i2c_allowlist.rs` 中的 allowlist 扩展。
- `src/telemetry/normal_ui.rs` 中的主地址优先、`Address NAK` 才回退、单口独立解析与后续重试。

### Out of scope

- `docs/specs/j9twf-gc9307-normal-ui/SPEC.md` 中已冻结的正常界面口径。
- 任何与 SW2303 / TPS55288 控制相关的逻辑。
- 自动化硬件探测或 I2C 扫描。

## 需求（Requirements）

### MUST

- U13 先尝试 `0x40`，仅当主地址返回 `Address NAK` 时允许回退到 `0x44`。
- U17 先尝试 `0x41`，仅当主地址返回 `Address NAK` 时允许回退到 `0x45`。
- `Data NAK`、总线错误或其它错误不得触发 fallback。
- 两口地址解析必须彼此独立；单口失败不得阻断另一口继续解析与采样。
- 启动阶段未解析成功的端口，在后续刷新周期继续按相同规则重试。
- 兼容地址需要被 telemetry allowlist 明确放行。
- 代码注释需要明确说明 `0x44` / `0x45` 是现场异常兼容件的 fallback，而非设计地址。

### SHOULD

- 一次成功解析后缓存解析结果，避免每帧重复探测。

### COULD

- None.

## 功能与行为规格（Functional/Behavior Spec）

### Core flows

- 初始化时，USB-A 与 USB-C 各自独立执行“主地址 -> 兼容地址（仅 Address NAK）”的解析流程。
- 正常采样阶段沿用已解析出的地址。
- 若某口启动时仍未解析成功，则在后续刷新周期只对该口继续重试。

### Edge cases / errors

- 主地址返回 `Data NAK` 时，直接按错误处理，不尝试兼容地址。
- 若兼容地址同样失败，该口维持错误态，等待下一次刷新周期重试。
- 兼容地址恢复量测后，不改变 UI 的 present 判定规则。

## 接口契约（Interfaces & Contracts）

None。

## 验收标准（Acceptance Criteria）

- Given：U13 的 `0x40` 返回 `Address NAK`，`0x44` 可应答
  When：正常界面遥测初始化或后续重试执行
  Then：USB-A 成功切换到 `0x44` 并继续采样。
- Given：U17 的 `0x41` 返回 `Address NAK`，`0x45` 可应答
  When：正常界面遥测初始化或后续重试执行
  Then：USB-C 成功切换到 `0x45` 并继续采样。
- Given：主地址返回 `Data NAK`
  When：遥测初始化或重试执行
  Then：不触发 fallback，并按错误处理。
- Given：仅一口解析失败
  When：另一口地址可正常应答
  Then：可应答端口继续采样与显示，不被阻断。

## 实现前置条件（Definition of Ready / Preconditions）

- 正常界面基线规格已由 `docs/specs/j9twf-gc9307-normal-ui/SPEC.md` 承接。
- 兼容地址范围已冻结为 `U13: 0x44`、`U17: 0x45`。
- 主地址优先与 `Address NAK` 限定回退规则已确认。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- `just build`
- `cargo check`
- `cd web && bun run check`

### Quality checks

- PR checks stay green on the latest head.
- Fresh `codex review` on the PR head reports no merge-blocking findings.

## 文档更新（Docs to Update）

- `docs/specs/README.md`
- `docs/specs/3xckq-ina226-fallback-addresses/SPEC.md`

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 为 U13 / U17 增加兼容地址常量与 allowlist
- [x] M2: 实现主地址优先、`Address NAK` 才回退的独立解析逻辑
- [x] M3: 为当前实现变更补独立 spec，不混入 legacy 正常界面规格

## 方案概述（Approach, high-level）

- 保持正常界面旧规格与当前 fallback 变更分离：旧行为在 `j9twf`，当前补丁在 `3xckq`。
- 通过“只在 `Address NAK` 时回退”限制兼容范围，避免把普通总线异常误判为地址异常兼容件。

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：当前没有 mocked I2C 自动化测试覆盖这条状态机，回归仍主要依赖代码审阅与 CI。
- 风险：兼容件若存在寄存器级行为差异，仍可能在读数阶段暴露其它异常。
- 开放问题：无。
- 假设：`0x44` / `0x45` 仅用于现场异常兼容件，不改变原理图设计地址定义。

## 变更记录（Change log）

- 2026-03-11: 新增独立 fallback 规格，单独覆盖 `0x40 -> 0x44` 与 `0x41 -> 0x45` 的兼容地址策略。

## 参考（References）

- `docs/specs/j9twf-gc9307-normal-ui/SPEC.md`
- `src/telemetry/hardware.rs`
- `src/telemetry/i2c_allowlist.rs`
- `src/telemetry/normal_ui.rs`
