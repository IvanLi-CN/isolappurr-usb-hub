# `tps-sw` MCU 资源分配

本文记录当前正式 `tps-sw` 硬件和固件占用的 ESP32-S3 资源。硬件连接以
[`hardware/tps-sw/netlist.enet`](../hardware/tps-sw/netlist.enet) 为准，
运行资源以当前固件实现为准。`tps-fusb` 使用独立资源文档，不得混用。

## 固件目标

- Variant：`tps-sw`
- 状态：当前正式硬件与现有固件目标
- PD 输入：CH224Q
- PD 输出：SW2303 + TPS55288
- 构建策略：独立编译期 firmware profile；当前代码仍是本 variant 的实现

## 外设资源

| MCU 资源 | 配置 | 用途 |
| --- | --- | --- |
| `I2C1` | 400 kHz async；GPIO8/9 | 系统总线：TPS55288、INA226、TMP112、EEPROM、CH224Q |
| `I2C0` | 400 kHz async；GPIO39/40 | SW2303 独立总线 |
| `SPI2` | Mode 0，40 MHz async；GPIO10-14 | GC9307 显示 |
| `DMA_CH0` | SPI RX/TX buffer 4096 bytes | GC9307 SPI DMA |
| `USB_DEVICE` | USB Serial/JTAG async | JSONL 控制、provisioning、固件操作 |
| `UART0` | GPIO43/44 | 3-pin 调试串口 |
| GPIO interrupt | GPIO7，AnyEdge | `INT` 共享低有效告警 |
| ADC | 未占用 | 当前正式硬件没有 MCU 输入电压 ADC 合同 |
| PSRAM | 启动时探测并初始化 | 显示 front/back framebuffer 与外部内存分配 |

I2C 访问必须使用地址 allowlist，不允许扫描。当前固件中的系统总线 allowlist
为 INA226 fallback 地址、EEPROM `0x50` 与 TPS55288 `0x74`；SW2303 总线
只允许 `0x3C`。

## GPIO 资源

| GPIO | 网络 / 外设 | 用途 |
| --- | --- | --- |
| 0 | `BTNR` | 右键输入，低有效 |
| 1 | `BTNL` | 左键输入，低有效 |
| 2 | `P2_CED` | USB-C 数据路径控制 |
| 4 | `P1_CED` | USB-A 数据路径控制 |
| 5 | `P1_ESP` | USB-A 数据路由控制 |
| 6 | `LEDD` | 隔离侧 USB ready，低有效、高阻采样 |
| 7 | `INT` | 系统 I2C 共享中断，低有效 |
| 8 / 9 | `SDA / SCL` | `I2C1` 系统总线 |
| 10-15 | `DC/MOSI/SCLK/CS/RES/BLK` | `SPI2` 显示及背光 |
| 16 / 17 | `P1_EN# / P1_FAULT` | USB-A 电源使能与故障 |
| 18 | `UP0_PG` | 隔离侧 USB fault，高有效、高阻采样 |
| 19 / 20 | `USB_D- / USB_D+` | 原生 USB |
| 21 | `BUZZER` | 蜂鸣器输出 |
| 37 | `CE_TPS` | TPS55288 `EN/UVLO` 硬控制 |
| 39 / 40 | `SDA_SW / SCL_SW` | `I2C0` SW2303 总线 |
| 43 / 44 | `U0TX / U0RX` | UART0 调试口 |

## 空闲与保留资源

- 当前正式网表未连接：GPIO3、GPIO33-36、GPIO38、GPIO41-42、GPIO45-46。
- GPIO38 不再作为 `INT_TPS`；TPS55288 `FB/INT` 已并入 GPIO7 `INT`。
- 空闲仅描述 `tps-sw` 当前状态，不代表可跨 variant 直接复用。
