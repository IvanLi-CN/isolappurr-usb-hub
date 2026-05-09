# tps-sw 网表排查清单

网表文件：`hardware/tps-sw/netlist.enet`

适用硬件：`tps-sw`（`SW2303 + TPS55288`）

说明：本清单基于**网表连线**与各器件**数据手册/典型应用**对照，不包含 PCB 布局/走线/ESD 结构的版图级验证。器件位号以当前网表为准。

## 关键器件定位（来自网表）

- `TPS55288`：`U14`
- `SW2303`：`U16`
- `CH318T`：`U1/U2`
- `LT4532B-351MGF`（隔离链路磁性器件）：`L1`
- `RT9013-33GB`：`U5`
- `CH412K`（ESD 阵列）：`D2/D3`
- `ECMF02-2AMX6`（USB2.0 EMI/ESD）：`L3`
- `CH442E`（USB2.0 数据开关）：`U7/U8/U18`
- `TMP112AIDRLR`（温度传感器）：`U23`

## 总体结构（快速确认）

- [x] 网表格式为 EasyEDA `.enet`（JSON），连通性来自各器件 `pinInfoMap[*].net`
- [x] 隔离域 `UGND/UVBUS/UVCC` 与主域 `GND/VIN/+5V/3V3` 未发现同一器件同时连接 `UGND` 与 `GND`
- [x] USB 隔离链路：`U1(CH318T)` 的 `DMX_U/DPX_U` ↔ `L1` ↔ `U2(CH318T)` 的 `DMX_D/DPX_D`

## P0：必须优先修复（不修可能不工作/可靠性极差）

### TPS55288（U14，Buck-Boost）

- [x] 你已确认 PCB 上 `U14` 的 `PGND` 与 `AGND` 处直接短接（因此 `AGND_TPS` 不会“浮地”）。
- [ ] 由于网表里 `AGND_TPS` 仍是独立网络，建议在原理图中增加 net-tie/0Ω（或等效做法）把 `AGND_TPS` 与 `GND/PGND` 的单点连接“显式化”，避免后续审阅/改版误判。
- [ ] 数据手册建议 `PGND plane` 与 `AGND plane` 在 `VCC` 去耦电容地端单点相连；请确认该短接点在版图上**等效位于 `C65(U14 VCC 去耦)` 的地端附近**，并确保高 di/dt 的功率回流不穿过 `AGND` 参考区域。
- [ ] 复核隔离边界：`UGND` 与 `GND` 的分割是否符合预期，避免 ESD/TVS/外壳等把隔离域与主域“意外短接”。

### RT9013-33GB（U5，LDO：UVBUS→UVCC）

- [ ] 网表中 `U5` 存在一个悬空引脚（`pin4`：net 为空）。若该脚为 `EN`（或其他不可悬空的功能脚），建议：直接接 `UVBUS`（常开）或接 MCU 控制并加明确上拉/下拉。

### CH412K（D2/D3，ESD 阵列）

- [ ] `D2/D3` 的 `VCC` 连接到 `P0_VBUS/P1_VBUS`，且未看到 `VCC` 就近 `0.1µF` 去耦；若器件手册要求 `VCC` 去耦或推荐 `VCC=3.3V`，建议：按手册补齐去耦/供电策略，或更换为无需 `VCC` 的 TVS/ESD 方案。

## P1：高风险/功能偏差（按需求决定）

### CH318T（U1/U2，USB 隔离/Hub）

- [ ] 晶振网络与手册推荐不一致：目前仅 `XO` 侧有 `30pF` 到地（`C16/C17`），`XI` 侧无对地电容；手册推荐晶体两侧各有对地电容并给出推荐值。建议按手册重构，并结合 `X2/X3(20MHz, CL=9pF)` 重新选值/校核起振裕量与频偏。
- [ ] 料号 OTP 版本（A1/A2）未在网表中体现；手册说明不同丝印会改变上位机模式下 `DMU/DPU` 的端口角色。建议记录来料丝印并与 `P0/P1` 的端口规划一致。
- [x] `LED/MODE(LEDD)` 外围（tps-sw 已确认）：
  - `R9=5.1kΩ → GND`：用于 `U2` 的模式配置下拉（手册描述为 5.1k 下拉进入下位机模式）。
  - `R8=1kΩ → LED1 → 3V3`：板载指示灯网络（`LEDD=0` 时 LED 亮，active-low 灌电流）。
  - `LEDD → MCU(GPIO6)`：tps-sw 网表中 `LEDD` 直接连接到 MCU `GPIO6`（无串联电阻）。
  - 说明：虽然 `LEDD` 有 `5.1k` 下拉，但该脚在本设计中仍会被 CH318 主动驱动；`5.1k@3.3V` 仅约 `0.65mA` 负载，处于 CH318 I/O 驱动能力范围内，因此不会导致信号“必然被钳死为低电平”。
  - 固件约束：MCU 必须以高阻输入读取（禁用内部上下拉/禁止输出驱动），避免反向干扰 `LEDD` 的模式/指示逻辑。

### SW2303（U16，USB‑C/PD 控制）

- [x] `U16` 电源反馈相关连接已按网表收敛：`pin13 -> VBUS_TPS`、`pin15 -> VOUT_TPS`、`pin14` 悬空；网表中不再存在 `FB_TPS/FB_INT` 反馈分压网络。
- [x] 启动依赖已确认：`U16(SW2303)` 与 `U14(TPS55288)` 共用 `SDA_TPS/SCL_TPS`，且 `U16 pin15(VIN)` 接 `VOUT_TPS`。TPS 主动放电约 1 秒后，实测 `SDA_TPS/SCL_TPS` 会被拉低；固件必须先释放并检查总线，必要时用一次 `CE_TPS` hard-start 恢复电源域，再写入 TPS 5V boot setpoint。
- [x] 固件启动策略已按实测收敛：PD I2C 初始化前以 open-drain 释放 `SDA_TPS/SCL_TPS`；常规输出控制优先通过 TPS55288 `OE` 寄存器；仅当放电后总线 stuck-low 或 TPS boot setpoint 不可达时，才允许短暂拉高 `CE_TPS` 做 hard-start；boot setpoint 写入成功后，固件继续释放总线并等待约 1.05 秒才访问 `SW2303`。TPS 是否进入 5V 设定不得根据 INA226 遥测读数判断。若 `SW2303` 上电后 `SDA_TPS` 仍为低，固件保持 TPS boot 输出并等待总线释放，不反复拉高 `CE_TPS`。
- [x] 固件必须固定周期读取 SW2303 目标电压/限流寄存器并跟随，不能用协议枚举或快充标志作为是否读取目标值的门槛；启动恢复阶段在首次稳定读通后写一次 SW2303 启动 `Enable Profile`，把协议/档位恢复到已知配置。
- [x] 固件不得读取、建模、记录或展示禁用的 SW2303 状态位；TPS 输出、USB-C present、协议活动、读取分支、状态机、错误恢复和 UI 状态都不得依赖该状态位。
- [x] `R31/R32` 已作为 USB2.0 串联电阻使用：`R31=22Ω (ESP_DM↔$2N245)`、`R32=22Ω (ESP_DP↔$2N246)`；旧反馈分压/短接相关的 `R33/R41/R42/R50` 不在网表中。
- [ ] 若产品需求包含 QC/BC1.2 等依赖 `DP/DM` 的快充兼容，请确认 SW2303 的 `DP/DM` 引脚在网表/原理图中已接入（否则仅剩 Type‑C/PD 走 CC）。

## P2：一致性/工程性改进（建议）

### ECMF02-2AMX6（L3，USB2.0 EMI/ESD）

- [x] `L3` 对 `DMU/DPU` 做 EMI/ESD；网表中存在一个 `NC` 悬空引脚（net 为空）以及 `UGND` 参考地，连接方式与数据手册一致。
- [ ] 注意：ECMF02 的 ESD 只覆盖穿过它的差分对，不覆盖 `CC/VBUS`；若接口需 IEC 等级，请为 `CC/VBUS` 单独规划保护器件与布局。

### USB-C：CC 电阻与 ESD

- [ ] 若存在 Type‑C 受电端（Sink），请确认 `CC1/CC2` 的 `Rd=5.1kΩ→(U)GND` 配置明确且一致，不留悬空与歧义。
- [ ] `CC` 线若需认证/强健性，请补充专用 ESD/TVS 通道，并按器件手册的走线/接地要求布局。

### CH442E（U7/U8，USB2.0 数据开关）

- [x] `U7`（USB-A 数据路径）：`IN(pin1)=GND` 固定选择 S1，`EN#(pin9)=P1_CED`；`P1_CED=low` 使能连接，`P1_CED=high` 断开。
- [x] `U8`（USB-C/ESP/TPS 数据路径）：`IN(pin1)=P1_ESP`，`EN#(pin9)=P2_CED`；`P2_CED=low` 使能连接，`P2_CED=high` 断开。
- [x] `U18`（上游隔离域数据路径）：`IN(pin1)=UGND` 固定选择 S1，`EN#(pin9)=PU_CED`；`PU_CED=low` 使能连接，`PU_CED=high` 断开。
- [x] `RN3=10kΩ` 为 `P2_CED/P1_CED/P1_ESP` 提供下拉，避免这些控制脚在上电/复位期间悬空。

### TPS55288（U14，MODE/INT）

- [x] `MODE/RMODE`：`R35=75kΩ` 连接 `U14 pin15($1N57)` 到 `AGND_TPS`；按 TPS55288 MODE 电阻表，对应 external VCC、I2C 地址 `0x74`、PFM。
- [x] `U14 pin14` 连接 `INT_TPS`，并通过 `RN2` 的 4.7kΩ 上拉到 `3V3`；固件侧应按 active-low 中断/故障输入处理。
- [x] `R29=10mΩ` 位于 `ISP_TPS <-> VOUT_TPS`，与 `U17(INA226)` 共用输出电流采样路径。

### I2C1 设备

- [x] `INA226(U17)` 位于 `SDA/SCL`，用于输出电压/电流遥测。
- [x] `EEPROM(U21)` 位于 `SDA/SCL`，固件遥测路径不得误访问。
- [x] `TMP112(U23)` 位于 `SDA/SCL/INT`，网表显示 `ADD0` 接地；若启用温度遥测，应先补充地址 allowlist 与采样策略。

## 待确认（需要你给出需求/实物信息）

- [ ] 下行 USB‑C 口的协议需求：仅 PD（CC）还是还要兼容 QC/BC1.2（DP/DM）？
- [ ] `CH318T` 实物丝印是 A1 还是 A2？（决定上位机模式下 `DMU/DPU` 的端口角色）
- [ ] `CC/VBUS` 的 ESD 目标等级与测试标准（IEC 61000‑4‑2/‑4‑5 等）是什么？
