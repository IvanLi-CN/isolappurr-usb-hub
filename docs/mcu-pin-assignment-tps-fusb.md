# `tps-fusb` MCU 引脚分配

本文是设计中 `tps-fusb` 硬件的独立 MCU 引脚分配入口。固定项来自
[`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)；未改变的外围
暂以 `tps-sw` 为设计基线，但必须在正式网表导出后复核。本文不表示
`tps-fusb` 已有原理图、PCB 或固件支持。

## 完整分配基线

| GPIO | `tps-fusb` 网络 / 用途 | 状态 |
| --- | --- | --- |
| 0 | `BTNR`，右键输入，低有效 | 计划沿用 `tps-sw` |
| 1 | `VIN_DC_SENSE / ADC1_CH0` | 已冻结；由 `BTNL` 改为 DC 输入 ADC |
| 2 | `P2_CED`，USB-C 数据路径控制 | 计划沿用 `tps-sw` |
| 3 | 未分配 | 待正式网表确认 |
| 4 | `P1_CED`，USB-A 数据路径控制 | 计划沿用 `tps-sw` |
| 5 | `P1_ESP`，USB-A 路径状态 | 计划沿用 `tps-sw` |
| 6 | `LEDD`，隔离侧 USB ready | 计划沿用 `tps-sw` |
| 7 | `INT`，第一组 I2C 共享中断 | 计划沿用 `tps-sw` |
| 8 | `SDA`，第一组 I2C SDA | 计划沿用；设备归属待正式网表确认 |
| 9 | `SCL`，第一组 I2C SCL | 计划沿用；设备归属待正式网表确认 |
| 10 | `DC`，GC9307 data/command | 计划沿用 `tps-sw` |
| 11 | `MOSI`，GC9307 SPI MOSI | 计划沿用 `tps-sw` |
| 12 | `SCLK`，GC9307 SPI clock | 计划沿用 `tps-sw` |
| 13 | `CS`，GC9307 chip select | 计划沿用 `tps-sw` |
| 14 | `RES`，GC9307 reset | 计划沿用 `tps-sw` |
| 15 | `BLK`，GC9307 backlight gate | 计划沿用 `tps-sw` |
| 16 | `P1_EN#`，USB-A 电源开关使能 | 计划沿用 `tps-sw` |
| 17 | `P1_FAULT`，USB-A 电源故障 | 计划沿用 `tps-sw` |
| 18 | `UP0_PG`，隔离侧 USB fault | 计划沿用 `tps-sw` |
| 19 | `USB_D-` | 计划沿用 `tps-sw` |
| 20 | `USB_D+` | 计划沿用 `tps-sw` |
| 21 | `BUZZER` | 计划沿用 `tps-sw` |
| 33 | `PWR_INPUT_EN` | 已冻结；输入电源总使能 |
| 34 | `PWR_INPUT_SEL` | 已冻结；0=DC，1=USB |
| 35 | `BTNL` | 已冻结；左键迁移到此，低有效、内部上拉 |
| 36 | `TPS_USB_C_VBUS_EN` | 已冻结；TPS USB-C 输出 PMOS 控制 |
| 37 | `CE_TPS` | 已冻结；TPS55288 `EN/UVLO` 控制 |
| 38 | `INT2` | 已冻结；第二组设备共享中断，低有效、开漏 |
| 39 | 第二组 I2C SDA 候选 | 待正式网表确认 |
| 40 | 第二组 I2C SCL 候选 | 待正式网表确认 |
| 41 | 未分配 | 待正式网表确认 |
| 42 | 未分配 | 待正式网表确认 |
| 43 | `U0TX`，UART0 TX | 计划沿用 `tps-sw` |
| 44 | `U0RX`，UART0 RX | 计划沿用 `tps-sw` |
| 45 | 未分配 | 待正式网表确认 |
| 46 | 未分配 | 待正式网表确认 |

## 已冻结变更

| 功能 | `tps-sw` | `tps-fusb` |
| --- | --- | --- |
| 左键 `BTNL` | GPIO1 | GPIO35 |
| DC 输入采样 | 无 | GPIO1 / `VIN_DC_SENSE` |
| 输入电源总使能 | 无 | GPIO33 / `PWR_INPUT_EN` |
| 输入电源选择 | 无 | GPIO34 / `PWR_INPUT_SEL` |
| TPS USB-C VBUS PMOS | 无 | GPIO36 / `TPS_USB_C_VBUS_EN` |
| TPS 硬使能 | GPIO37 / `CE_TPS` | GPIO37 / `CE_TPS` |
| 第二组共享中断 | GPIO38 未连接 | GPIO38 / `INT2` |

## 总线与中断约束

- `INT2` 必须上拉到 3.3 V、低有效，只允许开漏输出共享；中断后固件
  轮询该组全部候选设备定位来源。
- GPIO39/40 仅是第二组 I2C SDA/SCL 候选，不在本文冻结两颗 FUSB302B、
  TPS55288、INA226、TMP112 或其他设备的具体总线归属。
- 两颗 FUSB302B 的地址、总线与 PCB 位置必须一起在正式网表阶段确认；
  不得因为 `tps-sw` 使用 GPIO39/40 连接 SW2303 就直接沿用其拓扑。

## 固件合同

`tps-fusb` 使用独立编译期 firmware profile。固件实现前必须以本表和最终
网表共同校验所有 GPIO；标记为“计划沿用”或“待正式网表确认”的条目均不
得被当作已生产硬件事实。
