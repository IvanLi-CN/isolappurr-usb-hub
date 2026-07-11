# `tps-fusb` MCU 资源分配

本文记录设计中 `tps-fusb` 对 ESP32-S3 外设、总线、中断、ADC、通信和
GPIO 的资源预算。固定项来自 [`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)。
当前尚无正式网表和固件实现，未冻结项不得作为已实现事实。

## 固件目标

- Variant：`tps-fusb`
- 状态：待设计
- PD 输入：FUSB302B sink PHY，由 MCU 实现 PD 3.0 Fixed + PPS
- PD 输出：FUSB302B source PHY + TPS55288，由 MCU 实现 PD 3.0 Fixed + PPS
- 构建策略：独立编译期 firmware profile 和独立固件镜像
- 运行时自动识别 variant：不要求

## 外设资源预算

| MCU 资源 | 分配 | 状态 / 约束 |
| --- | --- | --- |
| `I2C0` | 第二组 I2C 候选 | 控制器保留；具体设备和 GPIO39/40 待正式网表 |
| `I2C1` | 第一组 I2C 候选 | 计划沿用 GPIO8/9；具体设备归属待正式网表 |
| `SPI2` | GC9307 显示 | 计划沿用 Mode 0、40 MHz、GPIO10-14 |
| `DMA_CH0` | GC9307 SPI DMA | 计划沿用；与最终固件资源冲突复核 |
| `USB_DEVICE` | USB Serial/JTAG | 计划沿用 JSONL、provisioning 与固件操作 |
| `UART0` | 调试串口 | 计划沿用 GPIO43/44 |
| `ADC1_CH0` | `VIN_DC_SENSE` | 已冻结为 GPIO1；1:16 分压、100 nF 滤波 |
| GPIO interrupt 1 | `INT` / GPIO7 | 第一组共享中断计划沿用 |
| GPIO interrupt 2 | `INT2` / GPIO38 | 已冻结；3.3 V 上拉、低有效、仅开漏共享 |
| PSRAM | 显示与外部内存 | 计划沿用启动探测和 framebuffer 分配 |

两颗 FUSB302B 的 I2C 控制器、总线成员和地址冲突处理尚未冻结。正式网表
必须保证每颗器件可被 MCU 唯一访问；不得仅因 `tps-sw` 使用 GPIO39/40
连接 SW2303，就直接把任一 FUSB302B 固定到该总线。

## GPIO 资源预算

| GPIO | 网络 / 外设 | 状态 |
| --- | --- | --- |
| 0 | `BTNR` | 计划沿用 |
| 1 | `VIN_DC_SENSE / ADC1_CH0` | 已冻结 |
| 2 | `P2_CED` | 计划沿用 |
| 3 | 未分配 | 待正式网表 |
| 4-7 | `P1_CED/P1_ESP/LEDD/INT` | 计划沿用 |
| 8 / 9 | 第一组 I2C SDA / SCL | 引脚计划沿用，设备归属待定 |
| 10-15 | GC9307 `SPI2` 与背光 | 计划沿用 |
| 16-21 | USB-A 电源、状态、原生 USB、蜂鸣器 | 计划沿用 |
| 33 | `PWR_INPUT_EN` | 已冻结 |
| 34 | `PWR_INPUT_SEL` | 已冻结；0=DC，1=USB |
| 35 | `BTNL` | 已冻结；低有效、内部上拉 |
| 36 | `TPS_USB_C_VBUS_EN` | 已冻结；输出 PMOS 控制 |
| 37 | `CE_TPS` | 已冻结；TPS55288 `EN/UVLO` 控制 |
| 38 | `INT2` | 已冻结；第二组开漏共享中断 |
| 39 / 40 | 第二组 I2C SDA / SCL 候选 | 待正式网表 |
| 41 / 42 | 未分配 | 待正式网表 |
| 43 / 44 | `U0TX / U0RX` | 计划沿用 UART0 |
| 45 / 46 | 未分配 | 待正式网表 |

## 相对 `tps-sw` 的冻结变化

| MCU 资源 | `tps-sw` | `tps-fusb` |
| --- | --- | --- |
| GPIO1 | `BTNL` | `VIN_DC_SENSE / ADC1_CH0` |
| GPIO33 | 空闲 | `PWR_INPUT_EN` |
| GPIO34 | 空闲 | `PWR_INPUT_SEL` |
| GPIO35 | 空闲 | `BTNL` |
| GPIO36 | 空闲 | `TPS_USB_C_VBUS_EN` |
| GPIO37 | `CE_TPS` | `CE_TPS` |
| GPIO38 | 空闲 | `INT2` |
| PD PHY 控制 | CH224Q + SW2303 专用逻辑 | MCU 控制两颗 FUSB302B |
| firmware profile | 当前 profile | 独立 `tps-fusb` profile，待实现 |

## 待正式网表确认

- 两颗 FUSB302B 各自使用 `I2C0` 还是 `I2C1`，以及地址冲突处理。
- TPS55288、INA226、TMP112、EEPROM 与两颗 FUSB302B 的最终总线成员。
- GPIO39/40 是否作为第二组 I2C，以及两组 I2C 的速率和 allowlist。
- `INT` 与 `INT2` 各自共享的设备集合。
- SPI2、DMA_CH0、USB_DEVICE、UART0 和 PSRAM 是否继续按当前固件占用。
