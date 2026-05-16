# tps-sw 网表排查清单

网表文件：`hardware/tps-sw/netlist.enet`

适用硬件：`tps-sw`（`SW2303 + TPS55288`）

说明：本清单基于网表连线与器件手册核对，不包含 PCB 布局、阻抗、回流路径与实物电压波形验证。

## 关键器件定位

- `TPS55288`：`U14`
- `SW2303`：`U16`
- `CH318T`：`U1/U2`
- `B0503S-1WR3`（隔离 `3V3_CH`）：`U18`
- `CH442E`（USB2.0 数据开关）：`U7/U8`
- `TPD4E05U06`（P0 USB/CC ESD）：`D2`
- `TVS0500`（P0 VBUS 保护）：`U22`
- `ECMF02-2AMX6`（上游 USB2.0 EMI/ESD）：`L3`
- `RT9013-33GB`（`UVBUS -> UVCC`）：`U5`
- `TMP112AIDRLR`（温度传感器）：`U23`

## 固件相关网表变化

- `TPS55288(U14)` 位于系统 I2C：`SDA/SCL`，连接 ESP32-S3 `GPIO8/GPIO9`。
- `SW2303(U16)` 位于独立 I2C：`SDA_SW/SCL_SW`，连接 ESP32-S3 `GPIO39/GPIO40`。
- `TPS55288 FB/INT` 接共享 `INT`，连接 ESP32-S3 `GPIO7`；旧 `GPIO38/INT_TPS` 已空。
- `SDA/SCL/INT` 由 `RN1=4.7kΩ` 上拉到 `3V3`；该总线同时包含 `TPS55288`、`INA226`、`TMP112`、`EEPROM`、`CH224Q`。
- `SDA_SW/SCL_SW` 由 `R13/R3=4.7kΩ` 上拉到 `3V3`；该总线只包含 `SW2303` 与 MCU。
- `CE_TPS` 仍为 ESP32-S3 `GPIO37 -> Q5 -> TPS55288 EN/UVLO`。
- `U15` 改为 `GND/U0TX/U0RX` 串口调试口，不再引出 PD I2C 或 `CE_TPS`。
- `LEDD` 经 `R39=10kΩ` 接 ESP32-S3 `GPIO6`；`UP0_PG` 经 `R33=10kΩ` 接 ESP32-S3 `GPIO18`。
- 旧 `PU_CE/PU_CED` 侧带控制链路已移除，`GPIO36` 不再连接。

## 电源与隔离

- `U18(B0503S-1WR3)` 从 `UVBUS/UGND` 生成隔离输出 `3V3_CH/GND`。
- `3V3_CH` 供电给 `U2(CH318T)`、`U7/U8(CH442E)`、下游侧 CH318 去耦和 `LED1`。
- `R40(DNP, 1206)` 保留 `3V3_CH <-> 3V3` 可选连接位，默认不装；当前网表中 `3V3_CH` 与 `3V3` 未短接。
- `U1(CH318T)` 仍由 `UVCC` 供电，`UVCC` 来自 `U5(RT9013-33GB)`。
- `UGND` 与 `GND` 仍为隔离域分割；网表未显示直接短接。

## USB2.0 路径

- 上游 Type-C `USB1` 的 `DN1/DN2` 走 `DMU_UNSAFE -> L3 pin1 -> L3 pin6 -> DMU -> U1.DMU`。
- 上游 Type-C `USB1` 的 `DP1/DP2` 走 `DPU_UNSAFE -> L3 pin2 -> L3 pin5 -> DPU -> U1.DPU`。
- `L3` 的 `1<->6` 与 `2<->5` 各自贯穿，没有 D+/D- 交叉。
- `U7(CH442E)`：`IN=GND` 固定选择 S1，`P1_CED` 控制 `EN#`，低电平使能 USB-A 数据路径。
- `U8(CH442E)`：`IN=P1_ESP`，`P2_CED` 控制 `EN#`，低电平使能 USB-C/ESP/TPS 数据路径。
- `RN3=10kΩ` 为 `P2_CED/P1_CED/P1_ESP` 提供下拉，避免上电悬空。

## P0 口保护

- `D2(TPD4E05U06)` 保护 `P0_DP/P0_DM/P0_CC1/P0_CC2`。
- `D2` 的 `NC` 脚用于 straight-through routing，按 TI 手册可悬空或接地；当前用作走线穿越，不构成功能错误。
- `U22(TVS0500)` 保护 `P0_VBUS`，所有 `IN` 脚并到 `P0_VBUS`，`GND/EP` 接 `UGND`。

## 仍需靠实物或固件验证的事项

- `3V3_CH` 来自非稳压隔离 DC/DC，实物应确认 `U2(CH318T)` 工作期间落在 `3.0V~3.6V`。
- `SDA_SW/SCL_SW` 上拉到常供 `3V3`，而 `SW2303 VIN` 来自 `VOUT_TPS`；固件应避免在 `SW2303` 未上电或未 POR 完成时访问该总线。
- `TPS55288` 与其他系统 I2C 设备共享 `SDA/SCL/INT`，固件必须使用地址白名单并对共享 `INT` 做来源判定。
- `CH318T` 实物丝印 A1/A2 会影响上位机模式下 `DMU/DPU` 端口角色，硬件验收时应记录实物丝印。
