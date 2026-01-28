# CH318T LEDD 原始电平采集（作为 USB 链路指示输入）（#6xrna）

## 状态

- Status: 部分完成（2/3）
- Created: 2026-01-28
- Last: 2026-01-28

## 背景 / 问题陈述

- 设备当前需要一个“USB 通信是否建立”的可观测信号，用于固件逻辑与对外状态（`data_connected`）。
- 硬件上已将 `CH318T.LED/MODE(LEDD)` 通过电阻连接到 MCU GPIO，且板载 LED 工作正常。
- 本计划不关心 LED 语义的“解释”，而是要读取该节点的原始电平/波形，并将其作为上层状态的输入源。

## 已确认的事实（Repo reconnaissance）

- 信号源：`CH318T U2 pin13`（net：`LEDD`，即 `LED/MODE`）。
- 板载 LED 网络：`LED1 pin2 → 3V3`，`LED1 pin1 → R8(1k) → LEDD`；因此该脚为灌电流驱动，一般可认为 **`LEDD=0` 对应 LED 亮**（active-low）。
- MCU 连接：`R39`（标注 `n.c.` 的可选电阻）把 `LEDD` 接到 `U19 pin11`（net：`$1N241`）。
- GPIO 映射（基于仓库既有 pin→GPIO 记录）：`U19 pin13→GPIO8`、`pin14→GPIO9`、`pin15→GPIO10` 等（见 `docs/gc9307-telemetry-design.md`），因此 `U19 pin11` 对应 `GPIO6`。
- 端口归属：该 `CH318T` 隔离链路服务于 USB‑A 侧的数据路径；本计划把该信号用于 `port_a.state.data_connected`。

## 目标 / 非目标

### Goals

- 以 **不干扰现有 LED 与模式配置** 为前提，读取 `LEDD` 节点的原始电平/边沿变化。
- 提供稳定的“连接指示输入”信号（带必要的毛刺过滤/去抖），供固件内部状态机使用。
- 让 `net_http` 的 `state.data_connected` 能基于该输入反映链路变化（不新增 API 字段）。

### Non-goals

- 解码 USB 数据内容/带宽/速率（480Mbps/12Mbps/1.5Mbps）。
- 修改硬件与隔离边界（不新增跨域信号线、不改网表/PCB）。
- 在对 `LEDD` 信号语义未确认前，输出“高可信”的业务语义（仅作为输入源 + 可观测波形）。

## 范围（Scope）

### In scope

- 固件：将 `LEDD` 所连 GPIO 配置为高阻输入（禁用内部上下拉），并采集原始电平/边沿。
- 固件：实现基础滤波（去抖/毛刺过滤）与节流更新，提供稳定的 `connected_hint` 输入给端口状态。
- 固件（`net_http`）：`state.data_connected` 改为由该输入驱动（或至少在目标端口上由其驱动）。
- 文档：补充一份“信号来源/极性/刷新率/限制”的说明，避免后续误用。

### Out of scope

- 变更 `GET /api/v1/ports` 的 JSON schema（不新增字段、不破坏兼容性）。
- 将 `docs/plan/` 下的任何资产作为运行/交付依赖。

## 需求（Requirements）

### MUST

- GPIO 必须保持高阻输入：不输出、不上拉、不下拉，避免影响 `LEDD` 的电路电平与 LED 行为。
- 采集逻辑必须能抵抗短毛刺：对外输出的 `connected_hint` 不应因瞬时抖动频繁翻转。
- `net_http` 开启时：`state.data_connected` 在物理链路变化后应在可接受延迟内更新（目标：< 500ms）。
- 不引入新依赖；不修改现有“端口选择/扫描”等安全约束。

### SHOULD

- 提供调试可观测性：至少输出当前电平与“最近一次边沿时间”（日志或内存指标），便于现场定位。

### COULD

- 支持两种采集策略（边沿中断 / 定时采样）在编译期或配置期选择，便于在不同板子/噪声环境取舍。

## 接口契约（Interfaces & Contracts）

None（不改变既有 `/api/v1` schema；仅改变 `data_connected` 的输入来源以更贴近既有字段语义）。

## 验收标准（Acceptance Criteria）

- Given 固件将 `LEDD` GPIO 配置为高阻输入  
  When 板载 LED 显示状态发生变化（亮/灭/闪烁）  
  Then MCU 采集到的原始电平变化应与 LED 行为同步（允许滤波引入毫秒级延迟）。

- Given `net_http` 已开启  
  When `LEDD` 的稳定电平发生翻转（经本计划滤波后）  
  Then `GET /api/v1/ports` 中 `port_a.state.data_connected` 应在 500ms 内随之变化。

- Given 系统处于噪声/抖动环境  
  When `LEDD` 节点出现短毛刺  
  Then `state.data_connected` 不应在 1s 内反复抖动（抖动阈值以本计划确认的滤波参数为准）。

## 实现前置条件（Definition of Ready / Preconditions）

- 采集引脚已冻结：`LEDD` → `GPIO6`（`U19 pin11`）。
- 端口映射已冻结：`LEDD` 驱动 `port_a.state.data_connected`。
- 采集策略与参数已冻结：边沿中断优先；去抖窗口 `5–20ms`（实现阶段微调）。

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Build: `cargo build --release`（firmware）
- Build (feature): `cargo build --release --features net_http`（如适用）

### Quality checks

- Rustfmt（仓库既有约定）

## 文档更新（Docs to Update）

- `docs/netlist/tps-sw-checklist.md`: 补充 `R39`（LEDD→MCU）作为“读取 LED 原始电平”的用途说明与注意事项（高阻输入、不要驱动）。
- `docs/plan/0005:device-http-api/contracts/http-apis.md`: 不改 schema；如需补充 `data_connected` 的来源说明，以“Clarification”形式增量补充（可选，需主人确认是否要写入契约）。

## 资产晋升（Asset promotion）

None

## 实现里程碑（Milestones）

- [x] M1: 锁定 GPIO、实现 `LEDD` 原始电平采集（含滤波）与调试可观测性
- [x] M2: 将目标端口的 `data_connected` 改为由该输入驱动（不改 API schema）
- [ ] M3: 实机验证（断开/重连/噪声场景）并补齐文档说明

## 方案概述（Approach, high-level）

- 将 `LEDD` 视作“外部提供的 1-bit 状态源”，固件只做采集与稳定化（滤波），不在本计划内承诺其业务语义。
- `data_connected` 作为对外状态字段，仅使用“稳定化后的电平”作为输入；若未来需要更强语义（枚举成功/端口设备存在），另开计划扩展数据源。

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：
  - `LEDD` 同时承担模式配置/LED 驱动，外部负载复杂；采集必须保持高阻且需要滤波，否则易误判。
  - `LEDD` 语义可能随 CH318T OTP 版本/工作模式变化；本计划只读取原始信号，不保证语义稳定。
- 假设（需主人确认）：
  - `R39` 在你的实物上为“已焊接/可用”，并且 `GPIO6` 在固件中未被其它外设占用。

## 变更记录（Change log）

- 2026-01-28: 创建计划
- 2026-01-28: 完成 M1/M2（固件采集 LEDD 原始电平并驱动 `port_a.state.data_connected`）
