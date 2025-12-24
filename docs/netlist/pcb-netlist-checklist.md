# PCB 网表排查清单（PCB1）

网表文件：`docs/netlist/pcb.enet`

说明：本清单基于**网表连线**与各器件**数据手册/典型应用**对照，不包含 PCB 布局/走线/ESD 结构的版图级验证。

## 总体结构（快速确认）

- [x] 网表格式为 EasyEDA `.enet`（JSON），连通性来自各器件 `pinInfoMap[*].net`
- [x] 隔离域 `UGND/UVBUS/UVCC` 与主域 `GND/VIN/+5V/3V3` 未发现同一器件同时连接 `UGND` 与 `GND`
- [x] USB 隔离链路：`U24(CH318T)` 的 `DMX_U/DPX_U` ↔ `L5` ↔ `U25(CH318T)` 的 `DMX_D/DPX_D`

## P0：必须优先修复（不修可能不工作/可靠性极差）

### TPS55288（U1，Buck-Boost）

- [x] 你已确认 PCB 上 `U1` 的 `PGND(pin9)` 与 `AGND(pin10)` 处直接短接（因此 `AGND_TPS` 不会“浮地”）。
- [ ] 由于网表里 `AGND_TPS` 仍是独立网络，建议在原理图中增加 net-tie/0Ω（或等效做法）把 `AGND_TPS` 与 `GND/PGND` 的单点连接“显式化”，避免后续审阅/改版误判。
- [ ] 数据手册建议 `PGND plane` 与 `AGND plane` 在 `VCC` 去耦电容地端单点相连；请确认该短接点在版图上**等效位于 `C25(U1 VCC 去耦)` 的地端附近**，并确保高 di/dt 的功率回流不穿过 `AGND` 参考区域。
- [ ] 复核 `PGND_TPS` 的用途：目前 `USB1` 的外壳/ESD/TVS 多落在 `PGND_TPS`，但 `U1` 的 `PGND` 引脚（pin9/24）在网表里直接到 `GND`；确认这是有意的“接口地/功率地分割”，还是命名/网络误用。

### RT9013-33（U26，LDO：UVBUS→UVCC）

- [ ] `U26 EN(pin4)` 在网表中悬空；数据手册明确 “Enable input is CMOS logic and cannot be left floating”。建议：EN 直接接 `UVBUS`（常开）或接 MCU 控制并加明确上拉/下拉。

### CH412K（D7/D9，ESD 阵列）

- [ ] `D7/D9` 的 `VCC` 连接到 `P1_VBUS/P0_VBUS`，且未看到 `VCC` 就近 `0.1µF` 去耦；数据手册要求 `VCC` 旁必须放置 `0.1µF` 陶瓷电容并以低阻抗接地，且典型推荐 `VCC=3.3V`。建议：`VCC` 改接 `3V3/UVCC` + 补 `0.1µF`，或更换为无需 `VCC` 的 TVS/ESD 方案。

## P1：高风险/功能偏差（按需求决定）

### CH318T（U24/U25，USB 隔离/Hub）

- [ ] 晶振网络与手册推荐不一致：目前仅 `XO` 侧有 `30pF` 到地（`C102/C109`），`XI` 侧无对地电容；手册推荐晶体两侧各有对地电容（C5/C6）并给出推荐值。建议按手册重构，并结合 `X2/X3(20MHz, CL=9pF)` 重新选值/校核起振裕量与频偏。
- [ ] 料号 OTP 版本（A1/A2）未在网表中体现；手册说明不同丝印会改变上位机模式下 `DMU/DPU` 的端口角色。建议记录来料丝印并与 `USB9/USB8` 的端口规划一致。
- [ ] `LED/MODE` 外围：`U25` 通过 `R121=5.1k→GND` 固定下位机模式，但同脚还挂了 `LED11+R120` 到 `3V3`；`U24` 的 `LEDU` 未按“悬空/5.1k 上拉到 VDD33”处理，而是挂了 LED 网络。建议按手册的模式配置电路把模式电平做成“单一、明确”。

### SW2303（U3，USB-C 快充控制）

- [x] `U3` 的 `VFB(pin10)` 接地，符合手册 “FB feedback mode” 的配置条件。
- [ ] `U3 DP/DM(pin4/5)` 在网表中未连接：这将无法提供 QC/BC1.2 等依赖 DP/DM 的快充兼容（仅剩 Type‑C/PD 走 CC）。请确认产品需求是否接受。

## P2：一致性/工程性改进（建议）

### ECMF02-2AMX6（L6，USB2.0 EMI/ESD）

- [x] `L6` 对 `DMU/DPU` 做 EMI/ESD，`pin4` NC 悬空、`pin3` 接地，连接方式与数据手册一致。
- [ ] 注意：ECMF02 的 ESD 只覆盖穿过它的差分对，不覆盖 `CC/VBUS`；若接口需 IEC 等级，请为 `CC/VBUS` 单独规划保护器件与布局。

### USB-C：CC 电阻与 ESD

- [x] `USB9` 上 `R122/R123=5.1k→UGND` 是 Type‑C 受电端（Rd）必需配置，不是“可选电阻”。
- [ ] `USB9 UCC1/UCC2` 未看到专用 ESD 通道；如接口暴露/需认证，建议补充 CC 线 ESD（并按器件手册的走线/接地要求布局）。

### CH442E（U45/U46，USB2.0 数据开关）

- [ ] `EN#` 直接接地（常使能）+ `IN` 由 MCU 控制；上电/复位期间 MCU IO 可能浮空导致 USB 数据路径抖动。建议给 `IN` 加确定上拉/下拉，或改用 `EN#` 作为默认断开控制。

## 待确认（需要你给出需求/实物信息）

- [ ] `USB1` 快充口的协议需求：仅 PD（CC）还是还要兼容 QC/BC1.2（DP/DM）？
- [ ] `CH318T` 实物丝印是 A1 还是 A2？（决定上位机模式下 `DMU/DPU` 的端口角色）
- [ ] `D7/D9(CH412K)` 的 ESD 目标等级与测试标准（IEC 61000‑4‑2/‑4‑5 等）是什么？
