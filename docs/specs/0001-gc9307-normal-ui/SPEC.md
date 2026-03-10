# GC9307 正常界面规格（USB-A + USB-C/PD 双口电参量）（#0001）

## 状态

- Status: 已完成
- Created: 2026-01-07
- Last: 2026-03-10

## 背景 / 问题陈述

- 现状：GC9307 屏幕需要稳定展示两路接口的电参量，供日常观察与现场排障使用。
- 目标：提供“正常界面”作为默认运行界面，固定显示 USB-A 与 USB-C/PD 两口的电压、电流与功率。
- 本次补充：现场存在地址异常兼容件，正常界面的 INA226 遥测需要支持主地址优先、仅在 `Address NAK` 时回退到兼容地址。

## 目标 / 非目标

### Goals

- 固定展示 3 行 × 2 列的 `V/A/W` 电参量。
- 规定定宽格式、颜色、状态优先级与端口 present 判定。
- 明确 INA226 的校准参数、功率来源与地址兼容策略。
- 保证两口地址解析彼此独立，单口异常不阻断另一口继续工作。

### Non-goals

- 菜单、交互、历史曲线、数据记录/上报。
- 显示 PDO、协议类型、请求值等 PD 协议细节。
- 修改 PD 协商策略、主循环控制策略或运行时网络接口。

## 范围（Scope）

### In scope

- 正常界面的固定布局、格式化规则、颜色规则与刷新节奏。
- USB-A / USB-C 两颗 INA226 的量测、校准与功率寄存器读取。
- 端口 present 判定规则。
- INA226 地址兼容策略：`0x40 -> 0x44` 与 `0x41 -> 0x45`。
- 用户说明文档与 UI 设计文档对规格基线的引用。

### Out of scope

- 采样频率策略调整（仅要求界面每 500ms 刷新一次）。
- SW2303 / TPS55288 的协议与电源策略改动。
- 其它硬件变体的额外适配。

## 需求（Requirements）

### MUST

- 每次刷新输出 3 行 × 2 列内容；每行严格为 `left_cell(6) + ' ' + right_cell(6)`。
- 单元宽度固定为 6 字符，支持 `OK` / `未插入` / `ERROR ` / `OVER  ` 四种显示状态。
- 数值显示采用定宽 half-up 舍入：
  - `0.000 ≤ x < 10.000` -> `D.ddd`
  - `10.00 ≤ x < 100.00` -> `DD.dd`
  - `100.0 ≤ x < 1000.0` -> `DDD.d`
- 状态优先级为 `未插入 > ERROR > OVER > OK`，对每个端口、每个指标独立判定。
- 功率必须读取 INA226 Power 寄存器，不得由 `V × I` 推导。
- 屏幕刷新周期为 500ms。
- USB-A present 判定：电压有效且 `< 1.0V` 视为未插入。
- USB-C present 判定：依据 SW2303 协议激活状态，不使用 `online` bit，也不以 5V keep-alive 代替协议状态。
- 硬件映射（tps-sw）：
  - U13：INA226，主地址 `0x40`，兼容地址 `0x44`，分流 `R22=10mΩ`
  - U17：INA226，主地址 `0x41`，兼容地址 `0x45`，分流 `R29=10mΩ`
- 地址兼容策略必须满足：
  - 先试设计地址，再在 `Address NAK` 时尝试兼容地址
  - `Data NAK`、总线错误或其它错误不得触发 fallback
  - 两口独立解析；单口失败不得阻断另一口继续解析与采样
  - 启动阶段未解析成功的端口，在后续刷新周期继续按同样规则重试
- INA226 固定校准参数：
  - U13：`Current_LSB=62µA/bit`，`Calibration=8258`
  - U17：`Current_LSB=107µA/bit`，`Calibration=4785`
- 颜色（RGB565）：背景 `0x0000`；电压 `0xFE45`；电流 `0xF206`；功率 `0x4D6A`；未插入 `0x8410`；错误 `0xF800`；超量程 `0xFCC0`

### SHOULD

- 插入状态下任一项读取失败仅影响该项显示，不影响同口其它项与另一口显示。
- 地址解析结果在一次成功后缓存复用，避免每帧重复探测。

### COULD

- None.

## 功能与行为规格（Functional/Behavior Spec）

### Core flows

- 启动时初始化两口 INA226；每口先尝试设计地址，再在 `Address NAK` 时尝试兼容地址。
- 初始化完成后，界面每 500ms 采样并刷新一次 `V/A/W`。
- 若某口启动时未解析成功，后续刷新周期继续对该口做主地址优先的重试，不影响另一口持续采样。
- 渲染时根据 present 判定与字段结果，按优先级选择 `未插入 / ERROR / OVER / OK` 的显示文本与颜色。

### Edge cases / errors

- 非 `Address NAK` 的 I2C 错误视为测量失败，不切换兼容地址。
- 单项读数失败时显示 `ERROR `；超过量程时显示 `OVER  `。
- USB-C 若协议未激活，即使存在保底供电，也显示为未插入占位。

## 接口契约（Interfaces & Contracts）

None。

## 验收标准（Acceptance Criteria）

- Given：进入正常界面
  When：每 500ms 触发一次刷新
  Then：显示 3 行 × 2 列的 V/A/W 内容，且每行严格满足 13 字符布局。
- Given：U13 主地址 `0x40` 返回 `Address NAK` 且 `0x44` 可应答
  When：启动初始化或后续重试发生
  Then：USB-A 遥测切换到 `0x44` 并继续工作。
- Given：U17 主地址 `0x41` 返回 `Address NAK` 且 `0x45` 可应答
  When：启动初始化或后续重试发生
  Then：USB-C 遥测切换到 `0x45` 并继续工作。
- Given：某一口发生非 `Address NAK` 的 I2C 错误
  When：初始化或采样执行
  Then：该口不触发 fallback，并按测量失败处理。
- Given：仅一口解析失败
  When：另一口可正常应答
  Then：可应答端口继续采样与显示，不被阻断。

## 实现前置条件（Definition of Ready / Preconditions）

- 正常界面的布局、格式、颜色与端口判定口径已冻结。
- tps-sw 硬件映射、分流参数与 INA226 校准值已确认。
- 地址兼容策略范围已冻结为“仅 `Address NAK` 时回退”。
- 本规格对应的用户说明与 UI 设计文档已指向 `docs/specs/**` 作为规格基线。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Firmware build: `just build`
- Rust check: `cargo check`
- Repo quality gate: `cd web && bun run check`

### Quality checks

- Rust formatting and CI checks remain green on the PR head.

## 文档更新（Docs to Update）

- `docs/specs/README.md`: 新增 spec 索引并记录 PR #48
- `docs/specs/0001-gc9307-normal-ui/SPEC.md`: 迁移 legacy plan 并写入 fallback 规则
- `docs/gc9307-normal-ui-functional.md`: 规格基线改为 `docs/specs/**`
- `docs/gc9307-normal-ui-ui-design.md`: 规格基线改为 `docs/specs/**`

## 实现里程碑（Milestones / Delivery checklist）

- [x] M1: 冻结正常界面的布局、格式、状态与颜色口径
- [x] M2: 实现双口 INA226 遥测与 UI 渲染
- [x] M3: 实现主地址优先、仅 `Address NAK` 触发的 INA226 兼容地址 fallback
- [x] M4: 将该工作项从 `docs/plan` 迁移到 `docs/specs` 并同步相关文档引用

## 方案概述（Approach, high-level）

- 使用每口独立的地址解析状态，避免单口失败拖垮整条正常界面链路。
- 将 fallback 收敛为“仅在地址层缺席时启用”，避免把短暂总线异常误判为兼容地址需求。
- 通过 `docs/specs` 固化规格根，后续实现与 review 统一以 `SPEC.md` 为基线。

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：USB-C 是否显示数值仍受 SW2303 协议状态影响；INA226 fallback 仅解决量测地址异常，不改变 present 判定。
- 风险：现场兼容件的寄存器行为若与标准 INA226 不一致，仍可能在初始化或读数阶段暴露其它异常。
- 开放问题：无。
- 假设：兼容地址仅用于现场异常兼容件，不改变设计地址与原理图定义。

## 变更记录（Change log）

- 2026-03-10: 从 `docs/plan/0001:gc9307-normal-ui/PLAN.md` 迁移到 `docs/specs/0001-gc9307-normal-ui/SPEC.md`，并补充 INA226 主地址优先、`Address NAK` 才回退到 `0x44/0x45` 的兼容策略。

## 参考（References）

- `docs/gc9307-normal-ui-ui-design.md`
- `docs/gc9307-normal-ui-functional.md`
- `docs/hardware-variants.md`
- `hardware/tps-sw/netlist.enet`
- `docs/plan/0001:gc9307-normal-ui/tools/gc9307_render_preview.py`
