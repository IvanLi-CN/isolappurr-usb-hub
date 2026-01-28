# PCB v1.2：背光 MOS 极性修复 + SW2303/TPS55288 外部 +5V 供电（tps-sw）（#vqp6v）

## 状态

- Status: 已完成
- Created: 2026-01-28
- Last: 2026-01-28

## 背景 / 问题陈述

- `tps-sw` 方案中，屏幕背光由 `BLK` GPIO 通过 P 沟道 MOS（`Q8`）做 `3V3` 高边开关控制。
- 发现 `Q8` 源漏极性错误会导致背光开关行为异常（体二极管方向不符合预期）。
- PCB v1.2 计划把 `SW2303` 与 `TPS55288` 改为外部 `+5V` 供电，需要在实现前冻结：
  - `TPS55288 MODE` 配置电阻（`RMODE`）取值与 I2C 地址策略；
  - `CE_TPS`（下拉 `TPS55288 EN/UVLO`）的“期望影响范围”（是否需要同时复位/掉电 `SW2303`）。

## 目标 / 非目标

### Goals

- 修复背光开关电路：`Q8` 的 `S/D` 极性符合预期。
- `TPS55288` 使用外部 `+5V` 供电（`VCC=+5V`），并明确 `RMODE` 取值与 I2C 地址策略。
- `SW2303` 使用外部 `+5V` 供电（`VDD=+5V`）。
- 更新网表与相关文档，使仓库可复核且口径一致。

### Non-goals

- 不在本计划中改动固件逻辑（如 `BLK` PWM、按键策略、PD 策略等）。
- 不在本计划中做 PCB 走线/布局级审阅（仅做网表连通性核对）。
- 不做大范围硬件重构（例如重新选型、重新规划隔离/ESD 体系等）；如需要另开计划。

## 用户与场景（Users & Scenarios）

- 硬件迭代：需要把 v1.2 的关键电气变更（背光开关/供电方式）落到原理图/PCB，并导出新的 EasyEDA 网表供固件/文档对齐。
- 固件/系统联调：需要清楚 “断电（`CE_TPS`）” 到底会影响哪些芯片（VBUS / SW2303 / 其它）。

## 范围（Scope）

### In scope

- 仅适用硬件：`tps-sw`
- 变更点（以网表证据为准）：
  - 背光：`Q8(BSS84)` 源漏极性修复
  - 供电：`U14(TPS55288)` 外部 `+5V`；`U16(SW2303)` 外部 `+5V`
  - `TPS55288 MODE/RMODE` 取值与 I2C 地址（`0x74/0x75`）策略定稿
- 文档同步（只做口径与证据更新）

### Out of scope

- 变更 PD 协议策略或输出策略（除非硬件变更迫使策略调整；此类变更需另开计划）
- 其它未被点名的硬件功能变更

## 需求（Requirements）

### MUST

- **背光 MOS 极性修复（网表可证）**：`Q8.S=3V3`、`Q8.D=FPC1 pin1`、`Q8.G=BLK`。
- **TPS55288 外部 VCC（网表可证）**：
  - `U14.VCC=+5V`，且 `C65(>=4.7uF)` 在 `+5V` 与 `AGND_TPS` 之间去耦；
  - `U14.MODE` 通过 `RMODE` 电阻到 `AGND_TPS`，取值与外部 VCC 档位匹配；
  - I2C 地址与固件策略一致（保持 `0x74`）。
- **SW2303 外部供电（网表可证）**：`U16.VDD=+5V`。
- **I2C 电平域（网表/手册可证）**：
  - `SW2303` 的 I2C 复用脚为 `PRSET/SCK`（SCL）与 `ONLINE/NTC/SDA`（SDA）；
  - I2C 上拉保持为 `3V3`（不引入对 MCU 的 5V 上拉）；
  - `SW2303` 极限参数给出“其它管脚电压”最大值 `6V`，因此 `3V3` 上拉在绝对额定上是允许范围内。
- **隔离域一致性（网表可证）**：无单一器件同时连接 `UGND` 与 `GND`。

#### `RMODE` 取值（待主人选择后冻结）

（以下取值来自 TPS55288 数据手册的 `MODE` 电阻配置表；本计划默认先以“保持 I2C 地址 `0x74` 不变”为前提列出候选。）

| 目标 | I2C 地址 | 轻载模式 | `RMODE`（MODE→AGND） |
| --- | --- | --- | ---: |
| 外部 `VCC=+5V` | `0x74` | PFM | `75kΩ` |
| 外部 `VCC=+5V` | `0x74` | Forced PWM | `51.1kΩ` |

冻结结论（来自 v1.2 网表）：选择 `75kΩ`（外部 `VCC=+5V` + I2C `0x74` + PFM）。

## 接口契约（Interfaces & Contracts）

None

## 约束与风险（Constraints & Risks）

- `TPS55288` 外部 `VCC=+5V` 供电需满足数据手册约束（电压范围与供电能力），且需有就近去耦（`C65`）。
- `SW2303` 数据手册未给出 I2C VIH/VIL 的显式数值（至少在 DS076 v1.6 中未看到）；本计划以“绝对额定允许 + 网表已固定 3V3 上拉”为准入条件，并把“实机 I2C 可用性”放在实现阶段验收中确认。
- `CE_TPS` 若不再影响 `SW2303` 供电，可能改变“断电/重插”类功能的实际效果边界。

## 验收标准（Acceptance Criteria）

- Given：更新后的 `hardware/tps-sw/netlist.enet`
  When：检查 `Q8/U14/U16/C65/RMODE` 的 `pinInfoMap[*].net`
  Then：
    - `Q8.S=3V3`、`Q8.D=FPC1 pin1`、`Q8.G=BLK`
    - `U14.VCC=+5V` 且 `C65` 去耦落在 `+5V` 与 `AGND_TPS`
    - `U16.VDD=+5V`
    - `U14.MODE` 的 `RMODE` 取值与“外部 VCC + 目标 I2C 地址 + 轻载模式选择”一致
- Given：隔离域与主域网络
  When：扫描所有器件连接网络集合
  Then：无单一器件同时连接 `UGND` 与 `GND`

（补充关键边界与异常）

- 若 `SW2303` 数据手册显示 I2C 引脚不满足 `3V3` 上拉兼容性：必须在实现前给出电平域方案（例如统一上拉到可接受电压、或加电平转换），否则本计划不得进入 `待实现`。

## 实现前置条件（Definition of Ready / Preconditions）

- `RMODE=75kΩ`（外部 `VCC=+5V` + I2C `0x74` + PFM）已冻结，并能落到网表/BOM
- 已明确 v1.2 下 `CE_TPS` 的影响范围：仅影响 `TPS55288 EN/UVLO`（不再假设会同时掉电 `SW2303`）

## 非功能性验收 / 质量门槛（Quality Gates）

### Testing

- Unit tests: None
- Integration tests: None
- E2E tests: None

### Quality checks

- `hardware/tps-sw/netlist.enet` 为有效 EasyEDA `.enet`（JSON 可解析）
- `docs/netlist/tps-sw-checklist.md` 重新过一遍（只更新口径/证据，不改变既有结论逻辑）

## 文档更新（Docs to Update）

- `docs/netlist/tps-sw-checklist.md`: 增加 v1.2 供电与 `RMODE`/地址策略说明
- `docs/pd-i2c-coordinator-design.md`: 明确 v1.2 下 `CE_TPS` 的影响范围（若发生变化）
- `docs/hardware-variants.md`: 更新 `tps-sw` 网表 sha256（以实现阶段导出的 `hardware/tps-sw/netlist.enet` 为准）

## 资产晋升（Asset promotion）

None

## 实现里程碑（Milestones）

- [ ] M1: 原理图/PCB 变更落地并导出新的 `hardware/tps-sw/netlist.enet`
- [ ] M2: 复核关键网络（背光 MOS、TPS55288 VCC/MODE、SW2303 VDD、隔离域）
- [ ] M3: 同步更新受影响文档并在 `docs/hardware-variants.md` 更新 sha256

## 方案概述（Approach, high-level）

- 以网表连通性为“最小可验证证据”，冻结：背光开关极性、TPS55288 外部 VCC 与 `RMODE` 策略、SW2303 供电方式。
- `TPS55288` I2C 电平可由其数据手册门限佐证；`SW2303` 的 I2C 电平兼容性必须以其手册为准后再冻结。

## 风险 / 开放问题 / 假设（Risks, Open Questions, Assumptions）

- 风险：
  - `SW2303` 在 `VDD=+5V` 下对 I2C 引脚的 VIH/过压限制未知，可能需要调整上拉电压或加电平转换。
  - `CE_TPS` 行为变化可能影响“断电/重插”类功能预期（若产品需求希望复位 PD 芯片）。
- 需要决策的问题：
  - 轻载模式（PFM vs Forced PWM）与 I2C 地址策略（`0x74/0x75`）会反推 `RMODE` 取值。
- 假设（需主人确认）：
  - 默认保持 `TPS55288` I2C 地址为 `0x74`，除非主人明确要求切换。

## 变更记录（Change log）

- 2026-01-28: 创建计划，冻结待确认点（`RMODE`、`SW2303` I2C 电平、`CE_TPS` 行为范围）。

## 参考（References）

- `hardware/tps-sw/netlist.enet`
- `docs/netlist/tps-sw-checklist.md`
- `docs/pd-i2c-coordinator-design.md`
