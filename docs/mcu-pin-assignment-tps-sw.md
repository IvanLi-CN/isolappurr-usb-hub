# `tps-sw` MCU 引脚分配

本文是当前正式 `tps-sw` 硬件的 MCU 引脚分配真相入口，依据
[`hardware/tps-sw/netlist.enet`](../hardware/tps-sw/netlist.enet) 整理。
固件默认仍以本表为目标；`tps-fusb` 的分配见
[`docs/mcu-pin-assignment-tps-fusb.md`](mcu-pin-assignment-tps-fusb.md)。

## 已分配 GPIO

| GPIO | 网络 | 方向 / 用途 |
| --- | --- | --- |
| 0 | `BTNR` | 输入；右键，低有效 |
| 1 | `BTNL` | 输入；左键，低有效 |
| 2 | `P2_CED` | 输出；USB-C 数据路径控制 |
| 4 | `P1_CED` | 输出；USB-A 数据路径控制 |
| 5 | `P1_ESP` | 输入；USB-A 路径状态 |
| 6 | `LEDD`（经 `R39`） | 输入；隔离侧 USB ready，低有效、高阻采样 |
| 7 | `INT` | 输入；系统 I2C 共享中断，低有效 |
| 8 | `SDA` | 系统 I2C SDA；TPS55288/INA226/TMP112/EEPROM/CH224Q |
| 9 | `SCL` | 系统 I2C SCL |
| 10 | `DC` | 输出；GC9307 data/command |
| 11 | `MOSI` | 输出；GC9307 SPI MOSI |
| 12 | `SCLK` | 输出；GC9307 SPI clock |
| 13 | `CS` | 输出；GC9307 chip select |
| 14 | `RES` | 输出；GC9307 reset |
| 15 | `BLK` | 输出；GC9307 backlight gate，低有效 |
| 16 | `P1_EN#` | 输出；USB-A 电源开关使能，低有效 |
| 17 | `P1_FAULT` | 输入；USB-A 电源故障 |
| 18 | `UP0_PG`（经 `R33`） | 输入；隔离侧 USB fault，高有效、高阻采样 |
| 19 | `USB_D-` | 原生 USB D- |
| 20 | `USB_D+` | 原生 USB D+ |
| 21 | `BUZZER` | 输出；蜂鸣器 |
| 37 | `CE_TPS` | 输出；经 NMOS 下拉 TPS55288 `EN/UVLO` |
| 39 | `SDA_SW` | SW2303 独立 I2C SDA |
| 40 | `SCL_SW` | SW2303 独立 I2C SCL |
| 43 | `U0TX` | UART0 TX；调试口 |
| 44 | `U0RX` | UART0 RX；调试口 |

## 未分配 GPIO

当前正式网表未连接以下 GPIO：

`GPIO3`、`GPIO33`、`GPIO34`、`GPIO35`、`GPIO36`、`GPIO38`、`GPIO41`、
`GPIO42`、`GPIO45`、`GPIO46`。

未分配不表示可在所有后续 variant 中自由复用。任何新增用途必须以对应
variant 的正式网表或设计 spec 为准。

## 总线与中断

- 系统 I2C：`GPIO8/SDA`、`GPIO9/SCL`、`GPIO7/INT`。
- SW2303 I2C：`GPIO39/SDA_SW`、`GPIO40/SCL_SW`。
- `GPIO38/INT_TPS` 在当前正式网表中未连接；TPS55288 `FB/INT` 已并入
  `GPIO7/INT`。

## 适用范围

本表只适用于 `tps-sw`。其中 `BTNL=GPIO1`、GPIO33-36 未连接及
`GPIO38` 未连接等结论，不得套用到 `tps-fusb`。
